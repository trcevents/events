// Called from the public comp intake form before it lets someone submit.
// Sends a 6-digit code by email (never a clickable link -- those get
// silently consumed by mail scanners before the human clicks them).
// Uses the service role internally since the caller is anonymous and
// comp_verifications has no public policies at all.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "TRC Events <hello@selassiefest.com>";
const CODE_TTL_MINUTES = 10;

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return new Response(JSON.stringify({ error: "Missing email" }), { status: 400 });
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await sha256(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { error: dbError } = await supabase
    .from("comp_verifications")
    .upsert(
      { email: email.trim().toLowerCase(), code_hash: codeHash, verified: false, attempts: 0, expires_at: expiresAt },
      { onConflict: "email" },
    );

  if (dbError) {
    return new Response(JSON.stringify({ error: dbError.message }), { status: 500 });
  }

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [email.trim()],
      subject: "Your verification code",
      html: `
        <p>Here's your verification code for the Charly Black comp ticket request:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p>
        <p>Enter it on the form to confirm your email. It expires in ${CODE_TTL_MINUTES} minutes.</p>
        <p style="margin-top:24px;color:#888;font-size:0.85rem;">If you didn't request this, you can ignore it.</p>
      `,
    }),
  });

  if (!emailRes.ok) {
    const text = await emailRes.text();
    return new Response(JSON.stringify({ error: `Resend error: ${text}` }), { status: 502 });
  }

  const emailBody = await emailRes.json();
  return new Response(JSON.stringify({ ok: true, _debug_email_id: emailBody.id }), { status: 200 });
});
