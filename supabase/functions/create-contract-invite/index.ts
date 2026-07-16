// Admin-only: generates a fresh per-performer contract access code. Never
// called from a browser -- Stephen calls it himself, either via the
// Supabase dashboard's "Invoke function" test panel (paste the JSON body
// below) or with curl:
//
//   curl -X POST https://xdjbgcqaynnzykrglgnf.supabase.co/functions/v1/create-contract-invite \
//     -H "x-admin-secret: <CONTRACT_ADMIN_SECRET value>" \
//     -H "Content-Type: application/json" \
//     -d '{"actName": "DJ Example", "role": "DJ", "eventName": "Charly Black — Good Times", "compensationTerms": "$150 flat fee, paid day-of by check"}'
//
// compensationTerms is optional -- omit it and the contract falls back to
// "To be provided separately in writing by Presenter."
//
// The response's plaintext `code` is shown exactly once (same as a GitHub
// PAT) -- text or email it to the performer yourself. Only its sha256 hash
// is ever stored, same pattern as comp_verifications/contract_verifications.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CONTRACT_ADMIN_SECRET = Deno.env.get("CONTRACT_ADMIN_SECRET");

const ROLES = ["Opening Act", "DJ", "Host", "Performer"];
// Unambiguous uppercase-alnum (no 0/O/1/I) so it's easy to read back over
// a phone call or text message.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 10;

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

  const { actName, role, eventName, compensationTerms } = await req.json();
  if (!actName || !role || !eventName) {
    return new Response(JSON.stringify({ error: "Missing actName, role, or eventName" }), { status: 400 });
  }
  if (!ROLES.includes(role)) {
    return new Response(JSON.stringify({ error: `role must be one of: ${ROLES.join(", ")}` }), { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const code = generateCode();
  const codeHash = await sha256(code);

  const insertRow = { access_code_hash: codeHash, act_name: actName, role, event_name: eventName };
  if (compensationTerms) insertRow.compensation_terms = compensationTerms;

  const { error } = await supabase.from("contract_invites").insert(insertRow);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, code, actName, role, eventName, compensationTerms }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
