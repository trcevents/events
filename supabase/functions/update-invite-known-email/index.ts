// Admin-only: sets/updates known_email on an existing invite by act_slug,
// so /get-started can start auto-sending that performer's code with no
// email prompt at all. Reusable as more emails come in over time --
// avoids needing a one-off migration each time. Never called from a
// browser -- Stephen calls it himself:
//
//   curl -X POST https://xdjbgcqaynnzykrglgnf.supabase.co/functions/v1/update-invite-known-email \
//     -H "x-admin-secret: <CONTRACT_ADMIN_SECRET value>" \
//     -H "Content-Type: application/json" \
//     -d '{"actSlug": "honezty", "knownEmail": "officialhonezty@gmail.com"}'
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const CONTRACT_ADMIN_SECRET = Deno.env.get("CONTRACT_ADMIN_SECRET");

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (req.headers.get("x-admin-secret") !== CONTRACT_ADMIN_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { actSlug, knownEmail } = await req.json();
  if (!actSlug || !knownEmail) {
    return new Response(
      JSON.stringify({ error: "Missing actSlug or knownEmail" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from("contract_invites")
    .update({ known_email: knownEmail.trim() })
    .eq("act_slug", actSlug)
    .select("act_slug, act_name, known_email")
    .single();

  if (error || !data) {
    return new Response(
      JSON.stringify({ error: error?.message ?? "Act not found." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
