// Called from the contract page's first step, when the performer types in
// the access code Stephen gave them. Read-only -- just confirms the code
// is valid and unsigned, and returns the act/role/event so the page can
// show "You're signing as: DJ Example (DJ) for Charly Black — Good Times"
// before asking for anything else. The real re-check happens again inside
// submit-talent-contract -- this step existing separately is purely UX
// (so a wrong code fails fast, before the email-verification step).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

  const { accessCode } = await req.json();
  if (!accessCode || typeof accessCode !== "string") {
    return new Response(JSON.stringify({ valid: false, error: "Missing access code" }), { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const codeHash = await sha256(accessCode.trim().toUpperCase());

  const { data: invite, error } = await supabase
    .from("contract_invites")
    .select("id, act_name, role, event_name, compensation_terms, status")
    .eq("access_code_hash", codeHash)
    .single();

  if (error || !invite) {
    return new Response(JSON.stringify({ valid: false, error: "That access code isn't recognized." }), { status: 200, headers: corsHeaders });
  }
  if (invite.status === "signed") {
    return new Response(JSON.stringify({ valid: false, error: "This contract has already been signed." }), { status: 200, headers: corsHeaders });
  }
  if (invite.status === "revoked") {
    return new Response(JSON.stringify({ valid: false, error: "This access code is no longer active." }), { status: 200, headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      valid: true,
      actName: invite.act_name,
      role: invite.role,
      eventName: invite.event_name,
      compensationTerms: invite.compensation_terms,
    }),
    { status: 200, headers: corsHeaders },
  );
});
