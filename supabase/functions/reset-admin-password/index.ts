// Called after the admin types in the code from request-admin-password-reset
// plus a new password. Verifies the code, then sets the password via the
// Auth admin API (needs service_role -- there's no user session yet at
// this point, that's the whole point of a password reset).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MAX_ATTEMPTS = 8;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  const { email, code, newPassword } = await req.json();
  if (!email || !code || !newPassword) {
    return new Response(JSON.stringify({ ok: false, error: "Missing email, code, or new password" }), { status: 400, headers: corsHeaders });
  }
  if (String(newPassword).length < 8) {
    return new Response(JSON.stringify({ ok: false, error: "Password must be at least 8 characters" }), { status: 200, headers: corsHeaders });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: row, error } = await supabase
    .from("admin_password_resets")
    .select("*")
    .eq("email", normalizedEmail)
    .single();

  if (error || !row) {
    return new Response(JSON.stringify({ ok: false, error: "No reset code on file -- request a new one" }), { status: 200, headers: corsHeaders });
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return new Response(JSON.stringify({ ok: false, error: "Too many attempts -- request a new code" }), { status: 200, headers: corsHeaders });
  }
  if (new Date(row.expires_at) < new Date()) {
    return new Response(JSON.stringify({ ok: false, error: "That code expired -- request a new one" }), { status: 200, headers: corsHeaders });
  }

  const codeHash = await sha256(String(code).trim());
  if (codeHash !== row.code_hash) {
    await supabase.from("admin_password_resets").update({ attempts: row.attempts + 1 }).eq("email", normalizedEmail);
    return new Response(JSON.stringify({ ok: false, error: "That code doesn't match" }), { status: 200, headers: corsHeaders });
  }

  const { data: usersPage, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    return new Response(JSON.stringify({ ok: false, error: listError.message }), { status: 500, headers: corsHeaders });
  }
  const user = usersPage.users.find((u) => (u.email || "").toLowerCase() === normalizedEmail);
  if (!user) {
    return new Response(JSON.stringify({ ok: false, error: "No account found for that email" }), { status: 200, headers: corsHeaders });
  }

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password: newPassword });
  if (updateError) {
    return new Response(JSON.stringify({ ok: false, error: updateError.message }), { status: 500, headers: corsHeaders });
  }

  await supabase.from("admin_password_resets").delete().eq("email", normalizedEmail);

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
});
