// Non-legal technical rider + hospitality + promo intake -- deliberately
// separate from submit-talent-contract (see migration 0010's comment on
// tech_rider_submissions for why). Gated by the same access code as the
// contract, re-checked here rather than trusted from the client, but does
// NOT require the contract to already be signed, and does NOT require
// email verification -- lower stakes than a legal signature.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "TRC Events <hello@selassiefest.com>";
const NOTIFY_TO = "stephen@selassiefest.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const body = await req.json();
  const { accessCode, socialMedia, pressPhotoUrl, shortBio, promoCommitmentAck, dj, openingAct } = body;

  if (!accessCode) {
    return new Response(JSON.stringify({ error: "Missing access code." }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const codeHash = await sha256(accessCode.trim().toUpperCase());

  const { data: invite, error: inviteError } = await supabase
    .from("contract_invites")
    .select("id, act_name, role, status")
    .eq("access_code_hash", codeHash)
    .single();

  if (inviteError || !invite) {
    return new Response(JSON.stringify({ error: "That access code isn't recognized." }), { status: 200, headers: corsHeaders });
  }
  if (invite.status === "revoked") {
    return new Response(JSON.stringify({ error: "This access code is no longer active." }), { status: 200, headers: corsHeaders });
  }

  const insertRow = {
    invite_id: invite.id,
    act_name: invite.act_name,
    role: invite.role,
    social_media: Array.isArray(socialMedia) ? socialMedia : null,
    press_photo_url: pressPhotoUrl || null,
    short_bio: shortBio || null,
    promo_commitment_ack: promoCommitmentAck === true,
  };

  if (invite.role === "DJ" && dj) {
    Object.assign(insertRow, {
      dj_format: dj.format || null,
      dj_equipment_needed: Array.isArray(dj.equipmentNeeded) ? dj.equipmentNeeded : null,
      dj_brings_own_gear: dj.bringsOwnGear ?? null,
      dj_needs_table_booth: dj.needsTableBooth ?? null,
      dj_needs_mc_mic: dj.needsMcMic ?? null,
      dj_set_style: dj.setStyle || null,
      dj_special_intro: dj.specialIntro || null,
      dj_preferred_genre: dj.preferredGenre || null,
      dj_no_play_list: dj.noPlayList || null,
    });
  } else if (openingAct) {
    Object.assign(insertRow, {
      oa_performer_count: openingAct.performerCount ?? null,
      oa_uses_backing_tracks: openingAct.usesBackingTracks ?? null,
      oa_mic_count: openingAct.micCount ?? null,
      oa_backing_track_format: openingAct.backingTrackFormat || null,
      oa_traveling_dj: openingAct.travelingDj ?? null,
      oa_input_list: openingAct.inputList || null,
      oa_stage_plot_notes: openingAct.stagePlotNotes || null,
      oa_special_props: openingAct.specialProps || null,
      oa_walk_on_cue: openingAct.walkOnCue || null,
    });
  }

  const { error: insertError } = await supabase.from("tech_rider_submissions").insert(insertRow);
  if (insertError) {
    console.error("tech_rider_submissions insert failed:", insertError);
    return new Response(JSON.stringify({ error: "Couldn't save your tech rider. Please try again." }), { status: 500, headers: corsHeaders });
  }

  const socialLine = Array.isArray(socialMedia) && socialMedia.length
    ? socialMedia.map((s) => `${escapeHtml(s.platform)}: ${escapeHtml(s.handle)}`).join(" — ")
    : "—";

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [NOTIFY_TO],
      subject: `Tech rider submitted: ${invite.act_name} (${invite.role})`,
      html: `
        <h2>New Tech Rider / Hospitality Submission</h2>
        <p><strong>Act:</strong> ${escapeHtml(invite.act_name)} (${escapeHtml(invite.role)})</p>
        <p><strong>Social:</strong> ${socialLine}</p>
        <p><strong>Bio:</strong> ${escapeHtml(shortBio || "—")}</p>
        <p><strong>Press photo:</strong> ${pressPhotoUrl ? `<a href="${escapeHtml(pressPhotoUrl)}">${escapeHtml(pressPhotoUrl)}</a>` : "—"}</p>
        ${
          dj
            ? `<p><strong>DJ format:</strong> ${escapeHtml(dj.format)} — equipment: ${escapeHtml((dj.equipmentNeeded || []).join(", "))}</p>`
            : openingAct
              ? `<p><strong>Performers:</strong> ${escapeHtml(openingAct.performerCount)}, mics: ${escapeHtml(openingAct.micCount)}</p>`
              : ""
        }
        <p>Full details in the tech_rider_submissions table.</p>
      `,
    }),
  });

  if (!emailRes.ok) {
    console.error("Resend send failed:", emailRes.status, await emailRes.text());
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
});
