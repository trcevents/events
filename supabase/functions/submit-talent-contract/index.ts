// Final step of the contract flow. Re-validates the access code and email
// verification itself (never trusts that the earlier steps happened -- this
// is the only function that actually writes a signed contract), generates
// a PDF, stores it in the private talent-contracts bucket, flips the
// invite to 'signed', and emails the PDF to stephen@selassiefest.com.
//
// DRAFT CONTRACT LANGUAGE: the clauses in buildContractSections() below are
// a standard-form starting point, not reviewed by a lawyer. Don't hand out
// real access codes (create-contract-invite) until Stephen or counsel has
// signed off on the wording.
//
// Deliberately does NOT collect a tax ID number (SSN/EIN) anywhere --
// tax_form_acknowledged is just Talent's acknowledgment that they'll
// provide a W-9 separately. Collecting actual tax IDs needs a properly
// compliant channel, not a general web form.
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "TRC Events <hello@selassiefest.com>";
const NOTIFY_TO = "stephen@selassiefest.com";

const PAYMENT_METHODS = [
  "Zelle",
  "Cash App",
  "Check",
  "Cash",
  "Bank Transfer",
  "Other",
];
const PAYEE_ENTITIES = ["Artist directly", "Manager", "Company/LLC"];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Deno's Response defaults to text/plain when Content-Type isn't set
// explicitly -- which makes supabase-js's functions.invoke() parse the
// body with .text() instead of .json(), so `data` ends up as a raw string
// and every `data?.field` check silently reads undefined. Every JSON
// response below must use this, not bare corsHeaders.
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function formatDate(dateStr) {
  if (!dateStr) return "To be confirmed";
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function wrapText(text, font, fontSize, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(test, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Standard-form independent performance agreement. See the DRAFT warning
// in the file header -- this is placeholder legal language, not reviewed
// by counsel.
function buildContractSections(d) {
  const sections = [
    {
      body:
        `This Independent Performance Agreement ("Agreement") is entered into as of ${d.signedDateStr}, ` +
        `by and between Ras Tafari Inc, an Illinois nonprofit corporation ("Presenter"), and ${d.signerFullLegalName}` +
        `${d.signerBusinessName ? ` d/b/a ${d.signerBusinessName}` : ""} ("Talent"), professionally known as ${d.actName}.`,
    },
    {
      heading: "1. Engagement",
      body:
        `Presenter engages Talent to perform as ${d.performanceType} (${d.role}) at "${d.eventName}" (the "Event") ` +
        `at ${d.venueName || "a venue to be confirmed"}${d.venueAddress ? `, ${d.venueAddress}` : ""}, on ${d.performanceDateStr}. ` +
        `Arrival/call time: ${d.arrivalTime || "to be confirmed"}. Soundcheck: ${d.soundcheckTime || "to be confirmed"}. ` +
        `Set time: ${d.setTime || "to be confirmed"}${d.setLengthMinutes ? `, approximately ${d.setLengthMinutes} minutes` : ""}.`,
    },
    {
      heading: "2. Compensation & Payment",
      body:
        `${d.compensationTerms} Payment method: ${d.paymentMethod}, payable to: ${d.payeeEntity}` +
        `${d.payeeDetails ? ` (${d.payeeDetails})` : ""}.`,
    },
    {
      heading: "3. Tax Documentation",
      body: d.taxFormRequired
        ? "Talent agrees to provide Presenter a completed IRS Form W-9 before payment is issued. Presenter will not collect a Social Security Number or Employer Identification Number through this contract; the W-9 must be provided separately and securely."
        : "No W-9 is required for this engagement.",
    },
    {
      heading: "4. Independent Contractor",
      body:
        "Talent is an independent contractor, not an employee, agent, or partner of Presenter. Talent is solely " +
        "responsible for Talent's own taxes, equipment, transportation, and insurance unless otherwise agreed in " +
        "writing.",
    },
    {
      heading: "5. Talent Responsibilities & Conduct",
      body:
        "Talent agrees to arrive prepared and on time, to perform professionally, and to comply with venue rules " +
        "and reasonable instructions from Presenter's event staff. Talent agrees to conduct themselves, and to " +
        "ensure anyone accompanying them conducts themselves, in a professional and lawful manner while at the " +
        "Event, including compliance with the venue's policies on alcohol, controlled substances, and safety.",
    },
    {
      heading: "6. Additional People",
      body:
        `Talent has indicated ${d.additionalPeopleCount} additional person(s) accompanying them` +
        `${d.additionalPeopleNotes ? ` (${d.additionalPeopleNotes})` : ""}. Any guest or ticket access for ` +
        `Talent or their party is arranged through TRC Events' ticketing process, not through this Agreement.`,
    },
    {
      heading: "7. No-Show / Late Arrival",
      body:
        "If Talent fails to arrive within thirty (30) minutes of the confirmed arrival/call time without prior " +
        "notice to Presenter, Presenter may treat this as a no-show, cancel Talent's engagement for the Event, " +
        "and Talent forfeits any deposit or compensation that would otherwise be due for the Event.",
    },
    {
      heading: "8. Cancellation",
      body:
        `Either party may cancel this engagement by providing written notice at least ${d.cancellationNoticeDays} ` +
        "days before the Event. Cancellation with less notice may forfeit any deposit paid, except where the " +
        "cancelling party is prevented from performing by a Force Majeure event (see below).",
    },
    {
      heading: "9. Force Majeure",
      body:
        "Neither party is liable for failure to perform due to causes beyond their reasonable control, including " +
        "but not limited to acts of God, severe weather, government order, venue closure, illness, or other " +
        "emergency. The affected party will notify the other as soon as reasonably possible.",
    },
    {
      heading: "10. Media & Promotion",
      body:
        "Talent grants Presenter a non-exclusive, royalty-free license to record, photograph, and use Talent's " +
        "name, likeness, and performance footage or photography from the Event for promotional purposes related " +
        "to the Event and Presenter's mission, unless Talent and Presenter agree otherwise in writing in advance.",
    },
    {
      heading: "11. Merchandise",
      body: d.merchRightsAllowed
        ? "Talent may sell official merchandise at the Event, subject to Presenter's standard venue table/fee policies as communicated in advance."
        : "Talent may not sell merchandise at the Event unless Presenter agrees otherwise in writing in advance.",
    },
  ];

  if (d.radiusClauseEnabled) {
    sections.push({
      heading: "12. Exclusivity (Radius Clause)",
      body:
        `Talent agrees not to perform${d.radiusMiles ? ` within ${d.radiusMiles} miles of the Event's venue` : " at another engagement in the same market"}` +
        `${d.radiusDays ? ` during the ${d.radiusDays} days before and after the Event` : ""}, without Presenter's prior written consent.`,
    });
  }

  sections.push(
    {
      heading: `${d.radiusClauseEnabled ? "13" : "12"}. Replacement / Substitution`,
      body:
        "If Talent becomes unable to perform, Presenter may accept a substitute performer of reasonably comparable " +
        "caliber in Talent's place; Talent will cooperate in good faith to identify a substitute where possible.",
    },
    {
      heading: `${d.radiusClauseEnabled ? "14" : "13"}. Liability & Indemnification`,
      body:
        "Talent performs at Talent's own risk. Talent agrees to release and hold harmless Presenter and its " +
        "officers, directors, volunteers, and agents from claims arising from Talent's participation in the " +
        "Event, except to the extent caused by Presenter's gross negligence or willful misconduct.",
    },
    {
      heading: `${d.radiusClauseEnabled ? "15" : "14"}. Independent Legal Review`,
      body: "This is a standard-form agreement. Either party may have this Agreement reviewed by independent legal counsel before signing.",
    },
    {
      heading: `${d.radiusClauseEnabled ? "16" : "15"}. Governing Law`,
      body: "This Agreement is governed by the laws of the State of Illinois.",
    },
    {
      heading: `${d.radiusClauseEnabled ? "17" : "16"}. Entire Agreement`,
      body:
        "This Agreement, together with any written amendments signed by both parties, constitutes the entire " +
        "agreement between Talent and Presenter regarding the Event and supersedes any prior oral or written " +
        "understandings.",
    },
    {
      heading: `${d.radiusClauseEnabled ? "18" : "17"}. Electronic Signature`,
      body:
        "Talent's typed name below, submitted through this online form, constitutes Talent's electronic " +
        "signature and has the same legal effect as a handwritten signature.",
    },
  );

  return sections;
}

async function buildContractPdf(d) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function ensureSpace(lineHeight) {
    if (y < MARGIN + lineHeight) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function drawParagraph(
    text,
    { size = 10.5, bold = false, gapAfter = 10, lineHeight = 14 } = {},
  ) {
    const useFont = bold ? boldFont : font;
    for (const line of wrapText(text, useFont, size, CONTENT_WIDTH)) {
      ensureSpace(lineHeight);
      page.drawText(line, {
        x: MARGIN,
        y,
        size,
        font: useFont,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= lineHeight;
    }
    y -= gapAfter;
  }

  drawParagraph("INDEPENDENT PERFORMANCE AGREEMENT", {
    size: 15,
    bold: true,
    gapAfter: 4,
    lineHeight: 18,
  });
  drawParagraph("Ras Tafari Inc  —  TRC Events", {
    size: 10,
    gapAfter: 18,
    lineHeight: 13,
  });

  for (const section of buildContractSections(d)) {
    if (section.heading)
      drawParagraph(section.heading, { bold: true, gapAfter: 3 });
    drawParagraph(section.body);
  }

  ensureSpace(160);
  y -= 10;
  drawParagraph("SIGNATURE", { bold: true, gapAfter: 6 });
  drawParagraph(`Talent's electronic signature: ${d.signatureTypedName}`);
  drawParagraph(
    `Legal name: ${d.signerFullLegalName}${d.signerBusinessName ? ` (${d.signerBusinessName})` : ""}`,
  );
  drawParagraph(`Government ID name on file: ${d.governmentIdName}`);
  drawParagraph(`Address: ${d.signerAddress}`);
  drawParagraph(`Email: ${d.signerEmail}`);
  drawParagraph(`Phone: ${d.signerPhone}`);
  drawParagraph(
    `Emergency contact: ${d.emergencyContactName} (${d.emergencyContactPhone})`,
  );
  drawParagraph(`Date signed: ${d.signedDateStr}`);
  drawParagraph(
    `Acting for Presenter: Ras Tafari Inc (by issuance of this contract's access code)`,
  );

  return pdfDoc.save();
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
    signerFullLegalName,
    signerBusinessName,
    signerAddress,
    signerEmail,
    signerPhone,
    emergencyContactName,
    emergencyContactPhone,
    governmentIdName,
    paymentMethod,
    payeeEntity,
    payeeDetails,
    taxFormAcknowledged,
    additionalPeopleCount,
    additionalPeopleNotes,
    signatureTypedName,
    agreedTerms,
  } = body;

  const missing = [];
  if (!accessCode) missing.push("accessCode");
  if (!signerFullLegalName) missing.push("signerFullLegalName");
  if (!signerAddress) missing.push("signerAddress");
  if (!signerEmail) missing.push("signerEmail");
  if (!signerPhone) missing.push("signerPhone");
  if (!emergencyContactName) missing.push("emergencyContactName");
  if (!emergencyContactPhone) missing.push("emergencyContactPhone");
  if (!governmentIdName) missing.push("governmentIdName");
  if (!paymentMethod) missing.push("paymentMethod");
  if (!payeeEntity) missing.push("payeeEntity");
  if (!signatureTypedName) missing.push("signatureTypedName");
  if (missing.length) {
    return new Response(
      JSON.stringify({
        error: `Missing required fields: ${missing.join(", ")}`,
      }),
      { status: 400, headers: jsonHeaders },
    );
  }
  if (agreedTerms !== true) {
    return new Response(
      JSON.stringify({
        error: "You must agree to the contract terms before submitting.",
      }),
      { status: 400, headers: jsonHeaders },
    );
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return new Response(
      JSON.stringify({
        error: `paymentMethod must be one of: ${PAYMENT_METHODS.join(", ")}`,
      }),
      { status: 400, headers: jsonHeaders },
    );
  }
  if (!PAYEE_ENTITIES.includes(payeeEntity)) {
    return new Response(
      JSON.stringify({
        error: `payeeEntity must be one of: ${PAYEE_ENTITIES.join(", ")}`,
      }),
      { status: 400, headers: jsonHeaders },
    );
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const normalizedEmail = signerEmail.trim().toLowerCase();

  // Re-check the access code -- never trust that verify-contract-access
  // was actually called first.
  const codeHash = await sha256(accessCode.trim().toUpperCase());
  const { data: invite, error: inviteError } = await supabase
    .from("contract_invites")
    .select("*")
    .eq("access_code_hash", codeHash)
    .single();

  if (inviteError || !invite) {
    return new Response(
      JSON.stringify({ error: "That access code isn't recognized." }),
      { status: 200, headers: jsonHeaders },
    );
  }
  if (invite.status !== "pending") {
    return new Response(
      JSON.stringify({
        error: `This contract is ${invite.status === "signed" ? "already signed" : "no longer active"}.`,
      }),
      { status: 200, headers: jsonHeaders },
    );
  }

  if (invite.tax_form_required && taxFormAcknowledged !== true) {
    return new Response(
      JSON.stringify({
        error:
          "You must acknowledge that you'll provide a W-9 before submitting.",
      }),
      { status: 200, headers: jsonHeaders },
    );
  }

  // Re-check email verification -- never trust the client-side step order.
  const { data: verified, error: verifyError } = await supabase.rpc(
    "contract_email_is_verified",
    { check_email: normalizedEmail },
  );
  if (verifyError || !verified) {
    return new Response(
      JSON.stringify({ error: "Please verify your email before submitting." }),
      { status: 200, headers: jsonHeaders },
    );
  }

  const signedDateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const pdfData = {
    actName: invite.act_name,
    role: invite.role,
    performanceType: invite.performance_type,
    eventName: invite.event_name,
    venueName: invite.venue_name,
    venueAddress: invite.venue_address,
    performanceDateStr: formatDate(invite.performance_date),
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
    signerFullLegalName: signerFullLegalName.trim(),
    signerBusinessName: signerBusinessName?.trim() || null,
    signerAddress: signerAddress.trim(),
    signerEmail: normalizedEmail,
    signerPhone: signerPhone.trim(),
    emergencyContactName: emergencyContactName.trim(),
    emergencyContactPhone: emergencyContactPhone.trim(),
    governmentIdName: governmentIdName.trim(),
    paymentMethod,
    payeeEntity,
    payeeDetails: payeeDetails?.trim() || null,
    additionalPeopleCount: Number(additionalPeopleCount) || 0,
    additionalPeopleNotes: additionalPeopleNotes?.trim() || null,
    signatureTypedName: signatureTypedName.trim(),
    signedDateStr,
  };

  let pdfBytes;
  try {
    pdfBytes = await buildContractPdf(pdfData);
  } catch (e) {
    console.error("PDF generation failed:", e);
    return new Response(
      JSON.stringify({
        error:
          "Couldn't generate the contract PDF. Nothing was saved -- try again.",
      }),
      { status: 500, headers: jsonHeaders },
    );
  }

  const { data: contractRow, error: insertError } = await supabase
    .from("talent_contracts")
    .insert({
      invite_id: invite.id,
      act_name: invite.act_name,
      role: invite.role,
      performance_type: invite.performance_type,
      event_name: invite.event_name,
      venue_name: invite.venue_name,
      venue_address: invite.venue_address,
      performance_date: invite.performance_date,
      arrival_time: invite.arrival_time,
      soundcheck_time: invite.soundcheck_time,
      set_time: invite.set_time,
      set_length_minutes: invite.set_length_minutes,
      compensation_terms: invite.compensation_terms,
      tax_form_required: invite.tax_form_required,
      cancellation_notice_days: invite.cancellation_notice_days,
      merch_rights_allowed: invite.merch_rights_allowed,
      radius_clause_enabled: invite.radius_clause_enabled,
      radius_miles: invite.radius_miles,
      radius_days: invite.radius_days,
      signer_full_legal_name: pdfData.signerFullLegalName,
      signer_business_name: pdfData.signerBusinessName,
      signer_address: pdfData.signerAddress,
      signer_email: pdfData.signerEmail,
      signer_phone: pdfData.signerPhone,
      emergency_contact_name: pdfData.emergencyContactName,
      emergency_contact_phone: pdfData.emergencyContactPhone,
      government_id_name: pdfData.governmentIdName,
      payment_method: pdfData.paymentMethod,
      payee_entity: pdfData.payeeEntity,
      payee_details: pdfData.payeeDetails,
      tax_form_acknowledged: taxFormAcknowledged === true,
      additional_people_count: pdfData.additionalPeopleCount,
      additional_people_notes: pdfData.additionalPeopleNotes,
      signature_typed_name: pdfData.signatureTypedName,
    })
    .select("id")
    .single();

  if (insertError || !contractRow) {
    console.error("talent_contracts insert failed:", insertError);
    return new Response(
      JSON.stringify({
        error: "Couldn't save your signed contract. Please try again.",
      }),
      { status: 500, headers: jsonHeaders },
    );
  }

  const storagePath = `${contractRow.id}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("talent-contracts")
    .upload(storagePath, pdfBytes, { contentType: "application/pdf" });

  if (uploadError) {
    console.error("PDF upload failed:", uploadError);
    // The signed record still exists even if storage failed -- don't lose
    // the signature over a storage hiccup. Stephen can regenerate/re-upload
    // by hand if this ever actually happens.
  } else {
    await supabase
      .from("talent_contracts")
      .update({ pdf_storage_path: storagePath })
      .eq("id", contractRow.id);
  }

  await supabase
    .from("contract_invites")
    .update({ status: "signed", signed_at: new Date().toISOString() })
    .eq("id", invite.id);

  const pdfBase64 = uint8ToBase64(pdfBytes);
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM,
      to: [NOTIFY_TO],
      subject: `Signed contract: ${pdfData.actName} (${pdfData.role}) — ${pdfData.eventName}`,
      html: `
        <h2>New Signed Talent Contract</h2>
        <p><strong>Act:</strong> ${pdfData.actName} (${pdfData.role}, ${pdfData.performanceType})</p>
        <p><strong>Event:</strong> ${pdfData.eventName} — ${pdfData.venueName}, ${pdfData.performanceDateStr}</p>
        <p><strong>Signer:</strong> ${pdfData.signerFullLegalName}${pdfData.signerBusinessName ? ` (${pdfData.signerBusinessName})` : ""} — ${pdfData.signerEmail}, ${pdfData.signerPhone}</p>
        <p><strong>Address:</strong> ${pdfData.signerAddress}</p>
        <p><strong>Emergency contact:</strong> ${pdfData.emergencyContactName} (${pdfData.emergencyContactPhone})</p>
        <p><strong>Compensation terms:</strong> ${pdfData.compensationTerms}</p>
        <p><strong>Payment:</strong> ${pdfData.paymentMethod} to ${pdfData.payeeEntity}${pdfData.payeeDetails ? ` (${pdfData.payeeDetails})` : ""}</p>
        <p><strong>W-9 acknowledged:</strong> ${taxFormAcknowledged === true ? "Yes" : "No (not required for this engagement)"}</p>
        <p><strong>Additional people:</strong> ${pdfData.additionalPeopleCount}${pdfData.additionalPeopleNotes ? ` (${pdfData.additionalPeopleNotes})` : ""}</p>
        <p><strong>Signed:</strong> ${signedDateStr}</p>
        <p>PDF attached.</p>
      `,
      attachments: [
        {
          filename: `${pdfData.actName.replace(/[^a-z0-9]+/gi, "-")}-contract.pdf`,
          content: pdfBase64,
        },
      ],
    }),
  });

  if (!emailRes.ok) {
    const text = await emailRes.text();
    console.error("Resend send failed:", emailRes.status, text);
    // The contract is already signed and saved -- don't tell the performer
    // it failed. Stephen can be notified/re-sent by hand from the
    // talent_contracts table + Storage if this ever actually happens.
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: jsonHeaders,
  });
});
