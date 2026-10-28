'use strict';
// Sending email (check-in details to guests).
//   RESEND_API_KEY   use Resend (resend.com), or
//   POSTMARK_TOKEN   use Postmark (postmarkapp.com)
//   MAIL_FROM        the sender, e.g. "The Inn <stay@yourdomain.com>" (must be a verified domain)
// With neither set, emails are written to the server log instead (fine for trying things out).

const sentLog = []; // last few messages, for tests and the owner screen
const configured = () => !!((process.env.RESEND_API_KEY || process.env.POSTMARK_TOKEN) && process.env.MAIL_FROM);

async function send({ to, subject, text, html, replyTo }) {
  const from = process.env.MAIL_FROM;
  const entry = { to, subject, text, html, at: new Date().toISOString(), via: 'log' };
  sentLog.push(entry); if (sentLog.length > 50) sentLog.shift();
  try {
    if (process.env.RESEND_API_KEY && from) {
      entry.via = 'resend';
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [to], subject, text, ...(html ? { html } : {}), ...(replyTo ? { reply_to: replyTo } : {}) }),
      });
      if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
      return true;
    }
    if (process.env.POSTMARK_TOKEN && from) {
      entry.via = 'postmark';
      const r = await fetch('https://api.postmarkapp.com/email', {
        method: 'POST', headers: { 'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ From: from, To: to, Subject: subject, TextBody: text, ...(html ? { HtmlBody: html } : {}), ...(replyTo ? { ReplyTo: replyTo } : {}), MessageStream: 'outbound' }),
      });
      if (!r.ok) throw new Error(`Postmark ${r.status}: ${await r.text()}`);
      return true;
    }
  } catch (e) {
    entry.error = e.message;
    console.error('Email failed:', e.message);
    return false;
  }
  if (process.env.NODE_ENV !== 'test') console.log(`\n--- Email (not sent: no email service set up) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
  return false;
}

module.exports = { send, configured, sentLog };
