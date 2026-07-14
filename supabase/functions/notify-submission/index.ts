// Fires on inserts into notification-worthy tables (raffle_entries,
// marketplace_preorders, and more as they're added) via a database trigger
// that calls net.http_post — see supabase/migrations. Not called from any
// client-side code; only the database itself calls this, authenticated by
// the shared WEBHOOK_SECRET header rather than a user JWT.
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');
const NOTIFY_TO = 'selassiefest@gmail.com';
// selassiefest.com is verified with Resend, so mail now sends from a real
// address instead of the onboarding@resend.dev sandbox (which could only
// ever deliver to the account's own inbox). reply_to keeps replies landing
// in the org's actual inbox rather than an address nobody checks.
const FROM = 'SelassieFest <hello@selassiefest.com>';
const REPLY_TO = 'selassiefest@gmail.com';
// "SelassieFest Newsletter" Resend Audience — lets staff compose and send
// campaigns to subscribers directly from the Resend dashboard (Broadcasts)
// without any code here. Every newsletter_subscribers insert gets synced
// into it below, in addition to the subscriber's own confirmation email.
const NEWSLETTER_AUDIENCE_ID = '6561e97b-31be-45c8-a069-e8d8ae29711e';
const STORAGE_PUBLIC_BASE = 'https://xdjbgcqaynnzykrglgnf.supabase.co/storage/v1/object/public/game-submissions';
const COMP_ADMIN_URL = 'https://trcevent.com/charly-black/comp-admin/';
// Comp-ticket approvers get copied on submissions crediting them, in
// addition to Stephen -- keeps this in sync with the approvers/comp_admins
// tables when adding/removing people.
const COMP_APPROVER_EMAILS = {
  'Marlon': 'marlontrc@gmail.com',
  'Kirk': 'prestigesoundkirk@gmail.com',
  'Dougie': 'douglas.allen@afccchicago.com',
  'Bobby': 'paksipras@gmail.com',
  'Dwight': 'smittyinnovation@gmail.com',
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c)=>({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[c]);
}
function formatRaffleEntry(record) {
  return {
    subject: `New Raffle Entry — ${record.buyer_name}`,
    html: `
      <h2>New Raffle Entry</h2>
      <p><strong>Buyer:</strong> ${escapeHtml(record.buyer_name)} (${escapeHtml(record.buyer_email)})</p>
      <p><strong>Tickets:</strong> ${escapeHtml(record.ticket_qty)} ($${escapeHtml(record.total_amount)})</p>
      <p><strong>Prize:</strong> ${escapeHtml(record.prize_name)}</p>
      <p><strong>Payment:</strong> ${escapeHtml(record.payment_method)}, TX: ${escapeHtml(record.transaction_id)}</p>
      <p><strong>Status:</strong> ${escapeHtml(record.status)}</p>
    `
  };
}
function formatMarketplacePreorder(record) {
  const items = Array.isArray(record.items) ? record.items : [];
  const itemsList = items.map((i)=>`${escapeHtml(i.name)}${i.variant ? ' (' + escapeHtml(i.variant) + ')' : ''} x${escapeHtml(i.qty)}`).join('<br>');
  return {
    subject: `New Marketplace Pre-Order — ${record.customer_name}`,
    html: `
      <h2>New Marketplace Pre-Order</h2>
      <p><strong>Customer:</strong> ${escapeHtml(record.customer_name)} (${escapeHtml(record.customer_email)}, ${escapeHtml(record.customer_phone)})</p>
      <p><strong>Pickup:</strong> ${escapeHtml(record.pickup_time)}</p>
      <p><strong>Guests:</strong> ${escapeHtml(record.guest_count)}</p>
      <p><strong>Items:</strong><br>${itemsList}</p>
      <p><strong>Total:</strong> $${escapeHtml(record.total_amount)}</p>
    `
  };
}
function formatVolunteerSignup(record) {
  return {
    subject: `New Volunteer Application — ${record.full_name}`,
    html: `
      <h2>New Volunteer Application</h2>
      <p><strong>Name:</strong> ${escapeHtml(record.full_name)} (${escapeHtml(record.email)}, ${escapeHtml(record.phone)})</p>
      <p><strong>Age:</strong> ${escapeHtml(record.age)}</p>
      <p><strong>Preferred Role:</strong> ${escapeHtml(record.role_choice)}</p>
      <p><strong>Shift:</strong> ${escapeHtml(record.shift_preference)}</p>
      <p><strong>T-Shirt:</strong> ${escapeHtml(record.tshirt_size)}</p>
      <p><strong>Emergency Contact:</strong> ${escapeHtml(record.emergency_contact)}</p>
      <p><strong>Accommodations:</strong> ${escapeHtml(record.accommodations)}</p>
      <p><strong>Referral:</strong> ${escapeHtml(record.referral_source)}</p>
      <p><strong>Waiver Accepted:</strong> ${record.waiver_accepted ? 'Yes' : 'No'}</p>
    `
  };
}
function formatSponsorInquiry(record) {
  const fields = Array.isArray(record.fields) ? record.fields : [];
  const fieldsList = fields.map((f)=>`<p><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value)}</p>`).join('');
  return {
    subject: `New Sponsor Inquiry — ${record.source_page || 'sponsors'}`,
    html: `
      <h2>New Sponsor Inquiry</h2>
      <p><strong>From page:</strong> ${escapeHtml(record.source_page)}</p>
      ${fieldsList}
    `
  };
}
function formatCampRegistration(record) {
  const data = record.registration_data || {};
  const weeks = Object.keys(data).filter((k)=>/^week\d+$/.test(k) && data[k]).map((k)=>k.replace('week', 'Week '));
  return {
    subject: `New Camp Registration — ${record.camper_name}`,
    html: `
      <h2>New Camp Registration</h2>
      <p><strong>Camper:</strong> ${escapeHtml(record.camper_name)}</p>
      <p><strong>Guardian:</strong> ${escapeHtml(record.guardian_name)} (${escapeHtml(record.guardian_email)}, ${escapeHtml(record.guardian_phone)})</p>
      <p><strong>Weeks Selected:</strong> ${weeks.length ? escapeHtml(weeks.join(', ')) : 'None selected'}</p>
      <p><strong>Full details:</strong> see the camp_registrations table in Supabase (registration_data column) for allergies, medical info, consents, and everything else submitted.</p>
    `
  };
}
function formatDonation(record) {
  const fundLabel = record.fund === 'scholarship' ? 'Youth Scholarship Fund' : 'General Fund';
  return {
    subject: `New Donation — $${escapeHtml(record.amount)}${record.recurring === 'true' ? '/mo' : ''} (${fundLabel})`,
    html: `
      <h2>New Donation</h2>
      <p><strong>Fund:</strong> ${escapeHtml(fundLabel)}</p>
      <p><strong>Amount:</strong> $${escapeHtml(record.amount)} ${escapeHtml((record.currency || 'usd').toUpperCase())}${record.recurring === 'true' ? ' / month (recurring)' : ' (one-time)'}</p>
      <p><strong>Donor Email:</strong> ${escapeHtml(record.email)}</p>
      <p><strong>Stripe Payment Intent:</strong> ${escapeHtml(record.payment_intent_id)}</p>
    `
  };
}
function formatGameSubmission(record) {
  const photoUrl = record.photo_path ? `${STORAGE_PUBLIC_BASE}/${record.photo_path}` : null;
  const videoUrl = record.video_path ? `${STORAGE_PUBLIC_BASE}/${record.video_path}` : null;
  return {
    subject: `New Games Archive Submission — ${record.game_name}`,
    html: `
      <h2>New Games Archive Submission</h2>
      <p><strong>Game:</strong> ${escapeHtml(record.game_name)} (${escapeHtml(record.game_slug)})</p>
      <p><strong>Submitted by:</strong> ${escapeHtml(record.submitter_name)}${record.submitter_email ? ' (' + escapeHtml(record.submitter_email) + ')' : ''}</p>
      ${record.story_text ? `<p><strong>Story:</strong><br>${escapeHtml(record.story_text)}</p>` : ''}
      ${photoUrl ? `<p><strong>Photo:</strong> <a href="${photoUrl}">${photoUrl}</a></p>` : ''}
      ${videoUrl ? `<p><strong>Video (temporary — move to YouTube, then update video_path and delete from Storage):</strong> <a href="${videoUrl}">${videoUrl}</a></p>` : ''}
      <p><strong>Status:</strong> ${escapeHtml(record.status)}</p>
    `
  };
}
function formatGameSubmissionConfirmation(record) {
  return {
    subject: `Thanks for sharing your ${record.game_name} story!`,
    html: `
      <h2>Thank you, ${escapeHtml(record.submitter_name)}!</h2>
      <p>We got your ${escapeHtml(record.game_name)} story${record.photo_path ? ', photo' : ''}${record.video_path ? ', video' : ''} for the Pickney Time Games Archive.</p>
      <p>Our team reviews every submission by hand — if yours is featured, we'll credit you right on the game's page.</p>
      <p style="margin-top:24px;color:#888;font-size:0.85rem;">Thank you for helping preserve this piece of culture for the next generation.</p>
    `
  };
}
// Most tables' triggers exist to notify staff of a new submission; a couple
// (newsletter signups, game story submissions) ALSO/instead send a
// confirmation back to the person who submitted — see TABLE_CONFIG below.
function formatDh101Signup(record) {
  return {
    subject: `New Dancehall 101 signup — ${record.full_name}`,
    html: `
      <h2>New Dancehall 101 Free Ticket Signup</h2>
      <p><strong>Name:</strong> ${escapeHtml(record.full_name)} (${escapeHtml(record.edu_email)})</p>
      <p><strong>School ID:</strong> ${escapeHtml(record.school_id)}</p>
      <p><strong>Segment:</strong> ${escapeHtml(record.student_segment)}</p>
      ${record.ambassador_id ? `<p><strong>Ambassador ID:</strong> ${escapeHtml(record.ambassador_id)}</p>` : ''}
      <p>Verification email has been sent to the student.</p>
    `
  };
}
function formatDh101VerificationEmail(record) {
  const verifyUrl = `https://selassiefest.com/dancehall101/ticket.html?token=${encodeURIComponent(record.verification_token)}`;
  return {
    subject: `Confirm your free Dancehall 101 ticket`,
    html: `
      <h2>You're almost in — Dancehall 101</h2>
      <p>Hi ${escapeHtml(record.full_name)}, click below to verify your .edu email and get your free ticket:</p>
      <p style="margin:20px 0;"><a href="${verifyUrl}" style="background:#0E5E36;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;display:inline-block;">Verify &amp; view my ticket</a></p>
      <p>Bring your ticket (this same link) and a physical photo ID (21+) to the door on Wednesday night at Uptown Lounge.</p>
      <p style="margin-top:24px;color:#888;font-size:0.85rem;">Dancehall 101 — presented by TRC Events. If you didn't sign up for this, you can safely ignore this email.</p>
    `
  };
}
function formatNewsletterConfirmation(record) {
  return {
    subject: `You're on the list — SelassieFest`,
    html: `
      <h2>Welcome to SelassieFest!</h2>
      <p>You're signed up for festival dates, camp registration, and community updates.</p>
      <p>We'll only email you when there's something worth sharing.</p>
      <p style="margin-top:24px;color:#888;font-size:0.85rem;">If you didn't sign up for this, you can safely ignore this email.</p>
    `
  };
}
function formatEventNotifySignup(record) {
  return {
    subject: `New "notify me" signup — ${record.event_name}`,
    html: `
      <h2>New Notify-Me Signup</h2>
      <p><strong>Event:</strong> ${escapeHtml(record.event_name)} (${escapeHtml(record.event_slug)})</p>
      <p><strong>Email:</strong> ${escapeHtml(record.email)}</p>
    `
  };
}
function formatEventNotifyConfirmation(record) {
  return {
    subject: `You're on the list — ${record.event_name}`,
    html: `
      <h2>You're on the list!</h2>
      <p>We'll email you the moment tickets for <strong>${escapeHtml(record.event_name)}</strong> go live.</p>
      <p style="margin-top:24px;color:#888;font-size:0.85rem;">If you didn't sign up for this, you can safely ignore this email.</p>
    `
  };
}
// Charly Black comp/sellable ticket intake (charly-black/comp/). Goes to
// Stephen specifically (not the shared NOTIFY_TO inbox) since he's the sole
// admin reviewer at charly-black/comp-admin/.
function formatCompRequest(record) {
  const approverLine = record.approver_listed
    ? escapeHtml(record.approver_name)
    : `${escapeHtml(record.approver_name)} (typed in — not on the approver list, double-check this)`;
  return {
    subject: `New comp request: ${record.full_name} (${record.tickets_requested} tickets)`,
    html: `
      <h2>New Comp/Sellable Ticket Request — Charly Black</h2>
      <p><strong>Name:</strong> ${escapeHtml(record.full_name)}</p>
      <p><strong>Crew/Org:</strong> ${escapeHtml(record.crew_or_org || '—')}</p>
      <p><strong>Email:</strong> ${escapeHtml(record.email)}</p>
      <p><strong>Phone:</strong> ${escapeHtml(record.phone || '—')}</p>
      <p><strong>Tickets requested:</strong> ${escapeHtml(record.tickets_requested)}</p>
      <p><strong>Told by:</strong> ${approverLine}</p>
      <p><strong>Notes:</strong> ${escapeHtml(record.notes || '—')}</p>
      <p><a href="${COMP_ADMIN_URL}">Review in the admin page →</a></p>
    `
  };
}
const TABLE_CONFIG = {
  raffle_entries: {
    notifications: [
      {
        to: ()=>NOTIFY_TO,
        format: formatRaffleEntry
      }
    ]
  },
  marketplace_preorders: {
    notifications: [
      {
        to: ()=>NOTIFY_TO,
        format: formatMarketplacePreorder
      }
    ]
  },
  volunteer_signups: {
    notifications: [
      {
        to: ()=>NOTIFY_TO,
        format: formatVolunteerSignup
      }
    ]
  },
  sponsor_inquiries: {
    notifications: [
      {
        to: ()=>NOTIFY_TO,
        format: formatSponsorInquiry
      }
    ]
  },
  camp_registrations: {
    notifications: [
      {
        to: ()=>NOTIFY_TO,
        format: formatCampRegistration
      }
    ]
  },
  stripe_donations: {
    notifications: [
      {
        to: ()=>NOTIFY_TO,
        format: formatDonation
      }
    ]
  },
  newsletter_subscribers: {
    notifications: [
      {
        to: (record)=>record.email,
        format: formatNewsletterConfirmation
      }
    ]
  },
  game_submissions: {
    notifications: [
      {
        to: ()=>NOTIFY_TO,
        format: formatGameSubmission
      },
      // Only sent if the submitter gave an email -- it's optional on this form.
      {
        to: (record)=>record.submitter_email,
        format: formatGameSubmissionConfirmation
      }
    ]
  },
  dh101_signups: {
    notifications: [
      {
        to: ()=>NOTIFY_TO,
        format: formatDh101Signup
      },
      {
        to: (record)=>record.edu_email,
        format: formatDh101VerificationEmail,
        from: ()=>'Dancehall 101 <hello@selassiefest.com>'
      }
    ]
  },
  event_notify_signups: {
    notifications: [
      {
        to: ()=>NOTIFY_TO,
        format: formatEventNotifySignup
      },
      {
        to: (record)=>record.email,
        format: formatEventNotifyConfirmation,
        from: (record)=>record.brand === 'trc' ? 'TRC Events <hello@selassiefest.com>' : 'SelassieFest <hello@selassiefest.com>'
      }
    ]
  },
  comp_requests: {
    notifications: [
      {
        to: (record)=>{
          const emails = ['stephen@selassiefest.com'];
          if (record.approver_listed && COMP_APPROVER_EMAILS[record.approver_name]) {
            emails.push(COMP_APPROVER_EMAILS[record.approver_name]);
          }
          return emails;
        },
        format: formatCompRequest,
        from: ()=>'TRC Events <hello@selassiefest.com>'
      }
    ]
  }
};
Deno.serve(async (req)=>{
  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response(JSON.stringify({
      error: 'unauthorized'
    }), {
      status: 401
    });
  }
  try {
    const payload = await req.json();
    const table = payload.table;
    const record = payload.record;
    const config = TABLE_CONFIG[table];
    if (!config) {
      return new Response(JSON.stringify({
        skipped: true,
        reason: `no formatter for table ${table}`
      }), {
        status: 200
      });
    }
    // Best-effort — a Resend Audience hiccup shouldn't block the
    // confirmation email itself.
    if (table === 'newsletter_subscribers') {
      try {
        await fetch(`https://api.resend.com/audiences/${NEWSLETTER_AUDIENCE_ID}/contacts`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: record.email,
            unsubscribed: false
          })
        });
      } catch (e) {
        console.error('Resend audience sync failed:', e);
      }
    }
    const results = [];
    for (const notification of config.notifications){
      const to = notification.to(record);
      if (!to) {
        results.push({
          skipped: true,
          reason: 'no recipient email on record'
        });
        continue;
      }
      const { subject, html } = notification.format(record);
      const from = notification.from ? notification.from(record) : FROM;
      const resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from,
          to,
          reply_to: REPLY_TO,
          subject,
          html
        })
      });
      if (!resendRes.ok) {
        const errText = await resendRes.text();
        console.error('Resend send failed:', resendRes.status, errText);
        results.push({
          error: errText
        });
      } else {
        results.push({
          sent: true,
          to
        });
      }
    }
    const anySent = results.some((r)=>r.sent);
    const anyError = results.some((r)=>r.error);
    return new Response(JSON.stringify({
      results
    }), {
      status: anySent || !anyError ? 200 : 502
    });
  } catch (e) {
    console.error('notify-submission error:', e);
    return new Response(JSON.stringify({
      error: String(e)
    }), {
      status: 500
    });
  }
});
