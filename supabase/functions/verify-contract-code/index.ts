// Called from the contract page after the user types in the code emailed
// to them by request-contract-verification. On success, marks the email
// as verified -- which is what contract_email_is_verified() checks, and
// what submit-talent-contract re-checks before it will generate a PDF.
// Mirrors verify-comp-code against contract_verifications instead.
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const { email, code } = await req.json();
  if (!email || !code) {
    return new Response(JSON.stringify({ valid: false, error: "Missing email or code" }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const normalizedEmail = email.trim().toLowerCase();

  const { data: row, error } = await supabase
    .from("contract_verifications")
    .select("*")
    .eq("email", normalizedEmail)
    .single();

  if (error || !row) {
    return new Response(JSON.stringify({ valid: false, error: "No code on file for this email -- request a new one" }), { status: 200, headers: corsHeaders });
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    return new Response(JSON.stringify({ valid: false, error: "Too many attempts -- request a new code" }), { status: 200, headers: corsHeaders });
  }

  if (new Date(row.expires_at) < new Date()) {
    return new Response(JSON.stringify({ valid: false, error: "That code expired -- request a new one" }), { status: 200, headers: corsHeaders });
  }

  const codeHash = await sha256(String(code).trim());

  if (codeHash !== row.code_hash) {
    await supabase.from("contract_verifications").update({ attempts: row.attempts + 1 }).eq("email", normalizedEmail);
    return new Response(JSON.stringify({ valid: false, error: "That code doesn't match" }), { status: 200, headers: corsHeaders });
  }

  await supabase.from("contract_verifications").update({ verified: true }).eq("email", normalizedEmail);
  return new Response(JSON.stringify({ valid: true }), { status: 200, headers: corsHeaders });
});
