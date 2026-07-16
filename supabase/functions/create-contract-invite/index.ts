// Admin-only: generates a fresh per-performer contract access code. Never
// called from a browser -- Stephen calls it himself, either via the
// Supabase dashboard's "Invoke function" test panel (paste the JSON body
// below) or with curl:
//
//   curl -X POST https://xdjbgcqaynnzykrglgnf.supabase.co/functions/v1/create-contract-invite \
//     -H "x-admin-secret: <CONTRACT_ADMIN_SECRET value>" \
//     -H "Content-Type: application/json" \
//     -d '{
//       "actName": "DJ Example",
//       "role": "DJ",
//       "performanceType": "DJ Set",
//       "eventName": "Charly Black — Good Times",
//       "venueName": "Bombay Banquet Hall",
//       "venueAddress": "2448 W. Devon Ave., Chicago, IL 60659",
//       "performanceDate": "2026-08-28",
//       "arrivalTime": "8:30 PM",
//       "soundcheckTime": "9:00 PM",
//       "setTime": "9:20 PM",
//       "setLengthMinutes": 20,
//       "compensationTerms": "$150 flat fee, paid day-of by check",
//       "taxFormRequired": false,
//       "cancellationNoticeDays": 14,
//       "merchRightsAllowed": true,
//       "radiusClauseEnabled": false,
//       "radiusMiles": null,
//       "radiusDays": null,
//       "guestListAllowance": 2
//     }'
//
// Only actName, role, eventName are required -- everything else falls back
// to a sensible default (see contract_invites' column defaults) if omitted.
// The response's plaintext `code` is shown exactly once (same as a GitHub
// PAT) -- text or email it to the performer yourself. Only its sha256 hash
// is ever stored, same pattern as comp_verifications/contract_verifications.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CONTRACT_ADMIN_SECRET = Deno.env.get("CONTRACT_ADMIN_SECRET");

const ROLES = ["Opening Act", "DJ", "Host", "Performer"];
const PERFORMANCE_TYPES = ["DJ Set", "Host/MC", "Solo Vocalist", "Group Performance", "Live Band with Tracks", "Other"];
// Unambiguous uppercase-alnum (no 0/O/1/I) so it's easy to read back over
// a phone call or text message.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 10;

// Optional fields the caller may pass, mapped to their contract_invites
// column name -- anything omitted just keeps the table's own default.
const OPTIONAL_FIELDS = {
  performanceType: "performance_type",
  venueName: "venue_name",
  venueAddress: "venue_address",
  performanceDate: "performance_date",
  arrivalTime: "arrival_time",
  soundcheckTime: "soundcheck_time",
  setTime: "set_time",
  setLengthMinutes: "set_length_minutes",
  compensationTerms: "compensation_terms",
  taxFormRequired: "tax_form_required",
  cancellationNoticeDays: "cancellation_notice_days",
  merchRightsAllowed: "merch_rights_allowed",
  radiusClauseEnabled: "radius_clause_enabled",
  radiusMiles: "radius_miles",
  radiusDays: "radius_days",
  guestListAllowance: "guest_list_allowance",
};

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (req.headers.get("x-admin-secret") !== CONTRACT_ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }

  const body = await req.json();
  const { actName, role, eventName } = body;
  if (!actName || !role || !eventName) {
    return new Response(JSON.stringify({ error: "Missing actName, role, or eventName" }), { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return new Response(JSON.stringify({ error: `role must be one of: ${ROLES.join(", ")}` }), { status: 400 });
  }
  if (body.performanceType && !PERFORMANCE_TYPES.includes(body.performanceType)) {
    return new Response(JSON.stringify({ error: `performanceType must be one of: ${PERFORMANCE_TYPES.join(", ")}` }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const code = generateCode();
  const codeHash = await sha256(code);

  const insertRow = { access_code_hash: codeHash, act_name: actName, role, event_name: eventName };
  for (const [jsonKey, column] of Object.entries(OPTIONAL_FIELDS)) {
    if (body[jsonKey] !== undefined && body[jsonKey] !== null) {
      insertRow[column] = body[jsonKey];
    }
  }

  const { error } = await supabase.from("contract_invites").insert(insertRow);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, code, ...body }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
