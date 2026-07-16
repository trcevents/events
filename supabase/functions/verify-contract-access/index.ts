// Called from both the contract page and the tech-rider page when the
// performer types in the access code Stephen gave them. Read-only -- just
// confirms the code is valid (not revoked) and returns the full deal
// summary (act/role/venue/date/fee/etc.) plus its status, so each caller
// can decide what "signed" should mean for it: the contract page treats an
// already-signed invite as an error (no re-signing), but the tech-rider
// page allows submitting either before or after the contract is signed.
// The real re-check happens again inside submit-talent-contract /
// submit-tech-rider -- this step existing separately is purely UX (so a
// wrong code fails fast, before the email-verification step).
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Deno's Response defaults to text/plain when Content-Type isn't set
// explicitly -- which makes supabase-js's functions.invoke() parse the
// body with .text() instead of .json(), so `data` ends up as a raw string
// and every `data?.valid`/`data?.error` check silently reads undefined.
// Every JSON response below must use this, not bare corsHeaders.
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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

  const { accessCode } = await req.json();
  if (!accessCode || typeof accessCode !== "string") {
    return new Response(
      JSON.stringify({ valid: false, error: "Missing access code" }),
      { status: 400, headers: jsonHeaders },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const codeHash = await sha256(accessCode.trim().toUpperCase());

  const { data: invite, error } = await supabase
    .from("contract_invites")
    .select("*")
    .eq("access_code_hash", codeHash)
    .single();

  if (error || !invite) {
    return new Response(
      JSON.stringify({
        valid: false,
        error: "That access code isn't recognized.",
      }),
      { status: 200, headers: jsonHeaders },
    );
  }
  if (invite.status === "revoked") {
    return new Response(
      JSON.stringify({
        valid: false,
        error: "This access code is no longer active.",
      }),
      { status: 200, headers: jsonHeaders },
    );
  }

  return new Response(
    JSON.stringify({
      valid: true,
      inviteId: invite.id,
      status: invite.status,
      actName: invite.act_name,
      role: invite.role,
      performanceType: invite.performance_type,
      eventName: invite.event_name,
      venueName: invite.venue_name,
      venueAddress: invite.venue_address,
      performanceDate: invite.performance_date,
      arrivalTime: invite.arrival_time,
      soundcheckTime: invite.soundcheck_time,
      setTime: invite.set_time,
      setLengthMinutes: invite.set_length_minutes,
      compensationTerms: invite.compensation_terms,
      taxFormRequired: invite.tax_form_required,
      cancellationNoticeDays: invite.cancellation_notice_days,
      merchRightsAllowed: invite.merch_rights_allowed,
      radiusClauseEnabled: invite.radius_clause_enabled,
      radiusMiles: invite.radius_miles,
      radiusDays: invite.radius_days,
    }),
    { status: 200, headers: jsonHeaders },
  );
});
