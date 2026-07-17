// Powers the "click your photo to get started" gallery page. Looks up an
// invite by its public-safe act_slug (never the real access code or its
// hash) and emails the existing plaintext code (see migration 0017 for
// why storing it is safe here) to:
//   - known_email, if Stephen already has it on file for this performer
//     -- no email input shown on the page at all in that case, and any
//     client-supplied email is ignored so it can't be redirected; or
//   - the email the client provides, if there's no known_email yet.
//
// Returns { needsEmail: true } (not an error) when there's no known_email
// and none was supplied, so the page knows to show an inline email field
// and retry, rather than treating it as a failure.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "TRC Events <hello@selassiefest.com>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function maskEmail(email) {
  const [user, domain] = email.split("@");
  if (!domain) return email;
  const visible = user.slice(0, 2);
  return `${visible}${"*".repeat(Math.max(user.length - 2, 1))}@${domain}`;
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

  const { actSlug, email } = await req.json();
  if (!actSlug) {
    return new Response(JSON.stringify({ error: "Missing actSlug." }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: invite, error } = await supabase
    .from("contract_invites")
    .select("id, act_name, status, known_email, access_code_plain")
    .eq("act_slug", actSlug)
    .single();

  if (error || !invite) {
    return new Response(
      JSON.stringify({ error: "That act isn't recognized." }),
      { status: 200, headers: jsonHeaders },
    );
  }
  if (!invite.access_code_plain) {
    // Only possible for invites created before this feature existed --
    // there's no plaintext on file to send.
    return new Response(
      JSON.stringify({
        error: "No access code on file for this act. Contact TRC Events.",
      }),
      { status: 200, headers: jsonHeaders },
    );
  }

  const targetEmail = invite.known_email || email?.trim();
  if (!targetEmail) {
    return new Response(JSON.stringify({ needsEmail: true }), {
      status: 200,
      headers: jsonHeaders,
    });
  }

  const statusNote =
    invite.status === "signed"
      ? " Your contract is already signed — this code still works for the tech rider form."
      : "";

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [targetEmail],
      subject: `Your TRC Events access code — ${invite.act_name}`,
      html: `
        <p>Here's your access code to start your contract at TRC Events:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${invite.access_code_plain}</p>
        <p>Enter it at <a href="https://trcevent.com/contract">trcevent.com/contract</a> to get started.${statusNote}</p>
        <p style="margin-top:24px;color:#888;font-size:0.85rem;">If you weren't expecting this, you can ignore it.</p>
      `,
    }),
  });

  if (!emailRes.ok) {
    const text = await emailRes.text();
    console.error("Resend send failed:", emailRes.status, text);
    return new Response(
      JSON.stringify({ error: "Couldn't send the email. Try again." }),
      { status: 502, headers: jsonHeaders },
    );
  }

  return new Response(
    JSON.stringify({ ok: true, sentTo: maskEmail(targetEmail) }),
    { status: 200, headers: jsonHeaders },
  );
});
