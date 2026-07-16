// Tailored version of the existing public comp/sellable ticket intake
// (comp_requests, /charly-black/comp/) for performers who just signed a
// contract -- "just like everyone else," but without re-asking for name/
// email/phone, which are already on file from the signed contract.
//
// Requires the invite to already be signed (i.e. talent_contracts has a
// row for it) -- identity fields are pulled from THAT row, never trusted
// from the client, so there's nothing for a caller to spoof beyond the
// ticket ask itself. Inserting into comp_requests fires the same
// comp_requests_notify trigger as the public form, so Stephen gets
// notified exactly the same way -- no changes needed there.
//
// event_name (added in migration 0012) comes from the invite, not the
// client -- so a future event's performer contracts land here correctly
// distinguished from Charly Black's, without touching this function again.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
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

  const body = await req.json();
  const {
    accessCode,
    wantsFree,
    freeTicketsRequested,
    wantsToSell,
    sellTicketsRequested,
    socialMedia,
    notes,
  } = body;

  if (!accessCode) {
    return new Response(JSON.stringify({ error: "Missing access code." }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
  if (!wantsFree && !wantsToSell) {
    return new Response(
      JSON.stringify({
        error: "Request free tickets, tickets to sell, or both.",
      }),
      { status: 400, headers: jsonHeaders },
    );
  }
  const freeCount = wantsFree ? Number(freeTicketsRequested) || 0 : 0;
  const sellCount = wantsToSell ? Number(sellTicketsRequested) || 0 : 0;
  if (wantsFree && (freeCount < 1 || freeCount > 2)) {
    return new Response(
      JSON.stringify({ error: "Free tickets must be between 1 and 2." }),
      { status: 400, headers: jsonHeaders },
    );
  }
  if (wantsToSell && (sellCount < 1 || sellCount > 10)) {
    return new Response(
      JSON.stringify({ error: "Tickets to sell must be between 1 and 10." }),
      { status: 400, headers: jsonHeaders },
    );
  }
  if (!Array.isArray(socialMedia) || socialMedia.length === 0) {
    return new Response(
      JSON.stringify({ error: "Add at least one social media handle." }),
      { status: 400, headers: jsonHeaders },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const codeHash = await sha256(accessCode.trim().toUpperCase());

  const { data: invite, error: inviteError } = await supabase
    .from("contract_invites")
    .select("id, act_name, event_name, status")
    .eq("access_code_hash", codeHash)
    .single();

  if (inviteError || !invite) {
    return new Response(
      JSON.stringify({ error: "That access code isn't recognized." }),
      { status: 200, headers: jsonHeaders },
    );
  }
  if (invite.status !== "signed") {
    return new Response(
      JSON.stringify({
        error: "Sign your contract before requesting tickets.",
      }),
      { status: 200, headers: jsonHeaders },
    );
  }

  const { data: contract, error: contractError } = await supabase
    .from("talent_contracts")
    .select("signer_full_legal_name, signer_email, signer_phone")
    .eq("invite_id", invite.id)
    .order("signed_at", { ascending: false })
    .limit(1)
    .single();

  if (contractError || !contract) {
    return new Response(
      JSON.stringify({
        error:
          "Couldn't find your signed contract. Try again or contact TRC Events.",
      }),
      { status: 500, headers: jsonHeaders },
    );
  }

  const { error: insertError } = await supabase.from("comp_requests").insert({
    full_name: contract.signer_full_legal_name,
    email: contract.signer_email,
    phone: contract.signer_phone,
    event_name: invite.event_name,
    tickets_requested: freeCount + sellCount,
    wants_free: !!wantsFree,
    free_tickets_requested: freeCount,
    wants_to_sell: !!wantsToSell,
    sell_tickets_requested: sellCount,
    approver_name: invite.act_name,
    approver_listed: false,
    social_media: socialMedia,
    notes: notes
      ? `[Performer contract ticket request] ${notes}`
      : "[Performer contract ticket request]",
  });

  if (insertError) {
    console.error("comp_requests insert failed:", insertError);
    return new Response(
      JSON.stringify({
        error: "Couldn't submit your ticket request. Please try again.",
      }),
      { status: 500, headers: jsonHeaders },
    );
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: jsonHeaders,
  });
});
