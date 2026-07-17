// Toggles a single status checkbox on one schedule_acts row (see migration
// 0015). Gated by the same shared PRODUCTION_SCHEDULE_PASSWORD as
// update-production-schedule -- one team password, not per-member
// accounts. field is allowlisted rather than trusting an arbitrary
// column name from the client.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PRODUCTION_SCHEDULE_PASSWORD = Deno.env.get(
  "PRODUCTION_SCHEDULE_PASSWORD",
);

const EDITABLE_FIELDS = [
  "online_promo",
  "social_media_received",
  "contract_signed",
  "tickets_ordered",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

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

  const { password, id, field, value } = await req.json();

  if (password !== PRODUCTION_SCHEDULE_PASSWORD) {
    return new Response(JSON.stringify({ error: "Wrong password." }), {
      status: 200,
      headers: jsonHeaders,
    });
  }
  if (!id || !EDITABLE_FIELDS.includes(field) || typeof value !== "boolean") {
    return new Response(JSON.stringify({ error: "Invalid request." }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from("schedule_acts")
    .update({ [field]: value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    console.error("schedule_acts update failed:", error);
    return new Response(
      JSON.stringify({ error: "Couldn't save. Try again." }),
      { status: 500, headers: jsonHeaders },
    );
  }

  return new Response(JSON.stringify({ ok: true, act: data }), {
    status: 200,
    headers: jsonHeaders,
  });
});
