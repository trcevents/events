// Called from the comp-admin "Forgot password?" link. Sends a 6-digit
// code by email (never a clickable link -- see comp intake verification
// for why). Always returns the same generic response regardless of
// whether the email matches a real admin, to avoid confirming who's on
// the roster to an outside caller.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "TRC Events <hello@selassiefest.com>";
const CODE_TTL_MINUTES = 10;
const COOLDOWN_SECONDS = 60;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const GENERIC_OK = { ok: true, message: "If that email is on file, a code has been sent." };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const { email } = await req.json();
  if (!email || typeof email !== "string") {
    return new Response(JSON.stringify({ error: "Missing email" }), { status: 400, headers: corsHeaders });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: admin } = await supabase
    .from("comp_admins")
    .select("email")
    .eq("email", normalizedEmail)
    .eq("active", true)
    .single();

  // Don't reveal whether the email matched -- same response either way.
  if (!admin) {
    return new Response(JSON.stringify(GENERIC_OK), { status: 200, headers: corsHeaders });
  }

  const { data: existing } = await supabase
    .from("admin_password_resets")
    .select("created_at")
    .eq("email", normalizedEmail)
    .single();

  if (existing) {
    const secondsSince = (Date.now() - new Date(existing.created_at).getTime()) / 1000;
    if (secondsSince < COOLDOWN_SECONDS) {
      const wait = Math.ceil(COOLDOWN_SECONDS - secondsSince);
      return new Response(JSON.stringify({ error: `Please wait ${wait}s before requesting another code.` }), { status: 200, headers: corsHeaders });
    }
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await sha256(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60 * 1000).toISOString();

  const { error: dbError } = await supabase
    .from("admin_password_resets")
    .upsert({ email: normalizedEmail, code_hash: codeHash, attempts: 0, expires_at: expiresAt }, { onConflict: "email" });

  if (dbError) {
    return new Response(JSON.stringify({ error: dbError.message }), { status: 500, headers: corsHeaders });
  }

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [email.trim()],
      subject: "Reset your comp admin password",
      html: `
        <p>Here's your password reset code for the Charly Black comp admin page:</p>
        <p style="font-size:28px;font-weight:700;letter-spacing:4px;">${code}</p>
        <p>Enter it on the page to set a new password. It expires in ${CODE_TTL_MINUTES} minutes.</p>
        <p style="margin-top:24px;color:#888;font-size:0.85rem;">If you didn't request this, you can ignore it -- your password won't change.</p>
      `,
    }),
  });

  return new Response(JSON.stringify(GENERIC_OK), { status: 200, headers: corsHeaders });
});
