// Called from the admin page (charly-black/comp-admin/) after Stephen approves a
// request and pastes in the Ticket Tailor access code/link. Emails the recipient
// their allocation + code, and records when it was sent.
//
// Runs with the caller's own Supabase session (forwarded Authorization header),
// so Row Level Security enforces that only stephen@selassiefest.com can trigger
// this — no service_role key needed.
import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
// selassiefest.com is the Resend-verified sending domain for this project
// (see supabase/functions/notify-submission) — reuse it rather than the
// unverified trcevent.com, which Resend would refuse to send from.
const FROM = "TRC Events <hello@selassiefest.com>";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Missing Authorization header", { status: 401 });
  }

  const { id } = await req.json();
  if (!id) {
    return new Response("Missing id", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: row, error } = await supabase
    .from("comp_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !row) {
    return new Response("Request not found (or not authorized)", { status: 404 });
  }

  if (row.status !== "approved" || !row.tt_access_info) {
    return new Response(
      "Request must be approved with tt_access_info set before sending",
      { status: 400 },
    );
  }

  const sellLine = row.wants_to_sell && row.sell_tickets_requested > 0
    ? `<p>Remember: you keep <strong>70%</strong> of every ticket you sell, for your first 10 sold. Sell more than
         that — up to 50 total — and you still keep <strong>50%</strong> on each one after that.</p>`
    : "";

  const html = `
    <p>Hi ${row.full_name},</p>
    <p>You're confirmed for <strong>${row.tickets_requested} ticket${row.tickets_requested === 1 ? "" : "s"}</strong>
       to Charly Black — Good Times (Friday, Aug 28, 2026 at Bombay Banquet Hall).</p>
    <p>Each ticket in your allocation is yours to use either as a <strong>free comp</strong> for yourself/your
       guests, or to <strong>sell</strong> — however you split it is up to you, up to your total of
       ${row.tickets_requested}.</p>
    ${sellLine}
    <p><strong>Your access link/code:</strong><br/>${row.tt_access_info}</p>
    <p>Questions? Call or text 414-909-3279.</p>
  `;

  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [row.email],
      reply_to: "selassiefest@gmail.com",
      subject: "Your Charly Black — Good Times ticket access",
      html,
    }),
  });

  if (!emailRes.ok) {
    const text = await emailRes.text();
    return new Response(`Resend error: ${text}`, { status: 502 });
  }

  const { error: updateError } = await supabase
    .from("comp_requests")
    .update({ access_sent_at: new Date().toISOString() })
    .eq("id", id);

  if (updateError) {
    return new Response(`Sent, but failed to record timestamp: ${updateError.message}`, { status: 207 });
  }

  return new Response("ok", { status: 200 });
});
