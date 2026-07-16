// Saves an edit to the live production schedule (see migration 0013).
// Gated by a shared team password (PRODUCTION_SCHEDULE_PASSWORD), not
// per-member accounts -- Stephen hands this one password out to whoever
// on the team needs to edit the schedule. Reading the schedule needs no
// password at all (public RLS SELECT policy); only writing does.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PRODUCTION_SCHEDULE_PASSWORD = Deno.env.get(
  "PRODUCTION_SCHEDULE_PASSWORD",
);
const SCHEDULE_ID = "00000000-0000-0000-0000-000000000001";

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

  const { password, content, updatedBy } = await req.json();

  if (password !== PRODUCTION_SCHEDULE_PASSWORD) {
    return new Response(JSON.stringify({ error: "Wrong password." }), {
      status: 200,
      headers: jsonHeaders,
    });
  }
  if (!content || typeof content !== "string") {
    return new Response(JSON.stringify({ error: "Missing content." }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from("production_schedule")
    .update({
      content,
      updated_by: updatedBy?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", SCHEDULE_ID)
    .select("content, updated_at, updated_by")
    .single();

  if (error || !data) {
    console.error("production_schedule update failed:", error);
    return new Response(
      JSON.stringify({ error: "Couldn't save. Try again." }),
      { status: 500, headers: jsonHeaders },
    );
  }

  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: jsonHeaders,
  });
});
