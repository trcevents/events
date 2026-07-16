// Saves an edit to the live production schedule (see migration 0013).
// Gated by a shared team password (PRODUCTION_SCHEDULE_PASSWORD), not
// per-member accounts -- Stephen hands this one password out to whoever
// on the team needs to edit the schedule. Reading the schedule needs no
// password at all (public RLS SELECT policy); only writing does.
//
// Per Stephen (2026-07-16): every save emails stephen@selassiefest.com,
// but with ONLY the diff (added/removed lines), not the whole document --
// re-reading the entire schedule on every small edit isn't useful, the
// point is seeing what changed. Fetches the row's current content before
// overwriting it so there's an old value to diff against.
import { createClient } from "npm:@supabase/supabase-js@2";
import { diffLines } from "npm:diff@5.2.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PRODUCTION_SCHEDULE_PASSWORD = Deno.env.get(
  "PRODUCTION_SCHEDULE_PASSWORD",
);
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SCHEDULE_ID = "00000000-0000-0000-0000-000000000001";
const FROM = "TRC Events <hello@selassiefest.com>";
const NOTIFY_TO = "stephen@selassiefest.com";
const SCHEDULE_URL = "https://trcevent.com/run-of-show/";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

async function sendDiffEmail({ oldContent, newContent, updatedBy }) {
  const parts = diffLines(oldContent || "", newContent);
  const removed = parts
    .filter((p) => p.removed)
    .map((p) => p.value)
    .join("");
  const added = parts
    .filter((p) => p.added)
    .map((p) => p.value)
    .join("");

  if (!removed && !added) {
    return; // saved with no actual change -- nothing worth emailing
  }

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [NOTIFY_TO],
      subject: `Production schedule updated${updatedBy ? ` by ${updatedBy}` : ""}`,
      html: `
        <h2>Production Schedule Changed</h2>
        <p><strong>By:</strong> ${escapeHtml(updatedBy || "unknown")}</p>
        <p><strong>When:</strong> ${new Date().toLocaleString()}</p>
        ${removed ? `<p><strong>Removed:</strong></p><pre style="background:#fee2e2;color:#7f1d1d;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(removed)}</pre>` : ""}
        ${added ? `<p><strong>Added:</strong></p><pre style="background:#dcfce7;color:#14532d;padding:12px;border-radius:6px;white-space:pre-wrap;">${escapeHtml(added)}</pre>` : ""}
        <p><a href="${SCHEDULE_URL}">View the full live schedule →</a></p>
      `,
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  const { password, content, updatedBy } = await req.json();

  if (password !== PRODUCTION_SCHEDULE_PASSWORD) {
    return new Response(JSON.stringify({ error: "Wrong password." }), {
      status: 200,
      headers: jsonHeaders,
    });
  }
  if (!content || typeof content !== "string") {
    return new Response(JSON.stringify({ error: "Missing content." }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: before, error: beforeError } = await supabase
    .from("production_schedule")
    .select("content")
    .eq("id", SCHEDULE_ID)
    .single();

  if (beforeError || !before) {
    return new Response(
      JSON.stringify({ error: "Couldn't load current schedule. Try again." }),
      { status: 500, headers: jsonHeaders },
    );
  }

  const { data, error } = await supabase
    .from("production_schedule")
    .update({
      content,
      updated_by: updatedBy?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", SCHEDULE_ID)
    .select("content, updated_at, updated_by")
    .single();

  if (error || !data) {
    console.error("production_schedule update failed:", error);
    return new Response(
      JSON.stringify({ error: "Couldn't save. Try again." }),
      { status: 500, headers: jsonHeaders },
    );
  }

  try {
    await sendDiffEmail({
      oldContent: before.content,
      newContent: content,
      updatedBy: updatedBy?.trim(),
    });
  } catch (e) {
    // The save already succeeded -- a notification hiccup shouldn't be
    // reported to the editor as a failure.
    console.error("diff email failed:", e);
  }

  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: jsonHeaders,
  });
});
