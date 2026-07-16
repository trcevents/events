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
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const FROM = "TRC Events <hello@selassiefest.com>";
const NOTIFY_TO = "stephen@selassiefest.com";

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

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
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
  return [
    {
      body:
        `This Independent Performance Agreement ("Agreement") is entered into as of ${d.signedDateStr}, ` +
        `by and between Ras Tafari Inc, an Illinois nonprofit corporation ("Presenter"), and ${d.signerFullLegalName} ` +
        `("Talent"), professionally known as ${d.actName}.`,
    },
    {
      heading: "1. Engagement",
      body:
        `Presenter engages Talent to perform as ${d.role} at the event known as "${d.eventName}" (the "Event"). ` +
        `Date, time, load-in, and set length will be confirmed separately in writing between Presenter and Talent.`,
    },
    { heading: "2. Compensation", body: d.compensationTerms },
    {
      heading: "3. Independent Contractor",
      body:
        `Talent is an independent contractor, not an employee, agent, or partner of Presenter. Talent is solely ` +
        `responsible for Talent's own taxes, equipment, transportation, and insurance unless otherwise agreed in ` +
        `writing.`,
    },
    {
      heading: "4. Talent Responsibilities",
      body:
        `Talent agrees to arrive prepared and on time, to perform professionally, and to comply with venue rules ` +
        `and reasonable instructions from Presenter's event staff.`,
    },
    {
      heading: "5. Cancellation",
      body:
        `Either party may cancel this engagement by providing written notice as far in advance as reasonably ` +
        `possible. [Placeholder -- a specific notice period and any deposit/refund terms should be added once ` +
        `Presenter's cancellation policy is finalized.]`,
    },
    {
      heading: "6. Media & Promotion",
      body:
        `Talent grants Presenter a non-exclusive, royalty-free license to use Talent's name, likeness, and ` +
        `performance footage or photography from the Event for promotional purposes related to the Event and ` +
        `Presenter's mission, unless Talent and Presenter agree otherwise in writing in advance.`,
    },
    {
      heading: "7. Liability",
      body:
        `Talent performs at Talent's own risk. Talent agrees to release and hold harmless Presenter and its ` +
        `officers, directors, volunteers, and agents from claims arising from Talent's participation in the ` +
        `Event, except to the extent caused by Presenter's gross negligence or willful misconduct.`,
    },
    {
      heading: "8. Independent Legal Review",
      body:
        `This is a standard-form agreement. Either party may have this Agreement reviewed by independent legal ` +
        `counsel before signing.`,
    },
    { heading: "9. Governing Law", body: `This Agreement is governed by the laws of the State of Illinois.` },
    {
      heading: "10. Entire Agreement",
      body:
        `This Agreement, together with any written amendments signed by both parties, constitutes the entire ` +
        `agreement between Talent and Presenter regarding the Event and supersedes any prior oral or written ` +
        `understandings.`,
    },
    {
      heading: "11. Electronic Signature",
      body:
        `Talent's typed name below, submitted through this online form, constitutes Talent's electronic ` +
        `signature and has the same legal effect as a handwritten signature.`,
    },
  ];
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

  function drawParagraph(text, { size = 10.5, bold = false, gapAfter = 10, lineHeight = 14 } = {}) {
    const useFont = bold ? boldFont : font;
    for (const line of wrapText(text, useFont, size, CONTENT_WIDTH)) {
      ensureSpace(lineHeight);
      page.drawText(line, { x: MARGIN, y, size, font: useFont, color: rgb(0.1, 0.1, 0.1) });
      y -= lineHeight;
    }
    y -= gapAfter;
  }

  drawParagraph("INDEPENDENT PERFORMANCE AGREEMENT", { size: 15, bold: true, gapAfter: 4, lineHeight: 18 });
  drawParagraph("Ras Tafari Inc  —  TRC Events", { size: 10, gapAfter: 18, lineHeight: 13 });

  for (const section of buildContractSections(d)) {
    if (section.heading) drawParagraph(section.heading, { bold: true, gapAfter: 3 });
    drawParagraph(section.body);
  }

  ensureSpace(100);
  y -= 10;
  drawParagraph("SIGNATURE", { bold: true, gapAfter: 6 });
  drawParagraph(`Talent's electronic signature: ${d.signatureTypedName}`);
  drawParagraph(`Legal name: ${d.signerFullLegalName}`);
  drawParagraph(`Address: ${d.signerAddress}`);
  drawParagraph(`Email: ${d.signerEmail}`);
  drawParagraph(`Phone: ${d.signerPhone}`);
  drawParagraph(`Date signed: ${d.signedDateStr}`);
  drawParagraph(`Acting for Presenter: Ras Tafari Inc (by issuance of this contract's access code)`);

  return pdfDoc.save();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  const body = await req.json();
  const { accessCode, signerFullLegalName, signerAddress, signerEmail, signerPhone, signatureTypedName, agreedTerms } = body;

  if (!accessCode || !signerFullLegalName || !signerAddress || !signerEmail || !signerPhone || !signatureTypedName) {
    return new Response(JSON.stringify({ error: "Missing required fields." }), { status: 400, headers: corsHeaders });
  }
  if (agreedTerms !== true) {
    return new Response(JSON.stringify({ error: "You must agree to the contract terms before submitting." }), { status: 400, headers: corsHeaders });
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
    return new Response(JSON.stringify({ error: "That access code isn't recognized." }), { status: 200, headers: corsHeaders });
  }
  if (invite.status !== "pending") {
    return new Response(JSON.stringify({ error: `This contract is ${invite.status === "signed" ? "already signed" : "no longer active"}.` }), { status: 200, headers: corsHeaders });
  }

  // Re-check email verification -- never trust the client-side step order.
  const { data: verified, error: verifyError } = await supabase.rpc("contract_email_is_verified", { check_email: normalizedEmail });
  if (verifyError || !verified) {
    return new Response(JSON.stringify({ error: "Please verify your email before submitting." }), { status: 200, headers: corsHeaders });
  }

  const signedDateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const pdfData = {
    actName: invite.act_name,
    role: invite.role,
    eventName: invite.event_name,
    compensationTerms: invite.compensation_terms,
    signerFullLegalName: signerFullLegalName.trim(),
    signerAddress: signerAddress.trim(),
    signerEmail: normalizedEmail,
    signerPhone: signerPhone.trim(),
    signatureTypedName: signatureTypedName.trim(),
    signedDateStr,
  };

  let pdfBytes;
  try {
    pdfBytes = await buildContractPdf(pdfData);
  } catch (e) {
    console.error("PDF generation failed:", e);
    return new Response(JSON.stringify({ error: "Couldn't generate the contract PDF. Nothing was saved -- try again." }), { status: 500, headers: corsHeaders });
  }

  const { data: contractRow, error: insertError } = await supabase
    .from("talent_contracts")
    .insert({
      invite_id: invite.id,
      act_name: invite.act_name,
      role: invite.role,
      event_name: invite.event_name,
      compensation_terms: invite.compensation_terms,
      signer_full_legal_name: pdfData.signerFullLegalName,
      signer_address: pdfData.signerAddress,
      signer_email: pdfData.signerEmail,
      signer_phone: pdfData.signerPhone,
      signature_typed_name: pdfData.signatureTypedName,
    })
    .select("id")
    .single();

  if (insertError || !contractRow) {
    console.error("talent_contracts insert failed:", insertError);
    return new Response(JSON.stringify({ error: "Couldn't save your signed contract. Please try again." }), { status: 500, headers: corsHeaders });
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
    await supabase.from("talent_contracts").update({ pdf_storage_path: storagePath }).eq("id", contractRow.id);
  }

  await supabase
    .from("contract_invites")
    .update({ status: "signed", signed_at: new Date().toISOString() })
    .eq("id", invite.id);

  const pdfBase64 = uint8ToBase64(pdfBytes);
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: [NOTIFY_TO],
      subject: `Signed contract: ${pdfData.actName} (${pdfData.role}) — ${pdfData.eventName}`,
      html: `
        <h2>New Signed Talent Contract</h2>
        <p><strong>Act:</strong> ${pdfData.actName} (${pdfData.role})</p>
        <p><strong>Event:</strong> ${pdfData.eventName}</p>
        <p><strong>Signer:</strong> ${pdfData.signerFullLegalName} (${pdfData.signerEmail}, ${pdfData.signerPhone})</p>
        <p><strong>Address:</strong> ${pdfData.signerAddress}</p>
        <p><strong>Compensation terms on this contract:</strong> ${pdfData.compensationTerms}</p>
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

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
});
