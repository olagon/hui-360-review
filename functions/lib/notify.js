// Optional sending. Off until the from address (EMAIL_FROM) is set.
//   Email: Cloudflare Email Sending through the hui360-mailer Worker (MAILER service binding, Workers Paid),
//          or Resend (RESEND_API_KEY) on the free plan.
//   Text:  TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM
import { HttpError } from './http.js';

export const channels = (env) => ({
  sms: !!(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM),
  email: !!(env.EMAIL_FROM && (env.MAILER || env.RESEND_API_KEY)),
});

// Email goes only to people with an address and Send email checked in People. Text is the fallback when Twilio is set up.
export const emailOf = (env, person) => (channels(env).email && person.email && person.send_email ? person.email : null);
export function route(env, person) {
  const email = emailOf(env, person);
  if (email) return { channel: 'email', to: email };
  if (channels(env).sms && person.phone) return { channel: 'sms', to: person.phone };
  return null;
}

const resend = async (env, path, payload) => {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new HttpError(502, `Email not sent: ${(await res.text()).slice(0, 200)}`);
};
// Replies reach a person: whoever is marked Director in People.
export async function directorEmail(env) {
  const row = await env.DB?.prepare("SELECT email FROM staff WHERE role = 'admin' AND active = 1 AND TRIM(COALESCE(email, '')) != '' ORDER BY id LIMIT 1").first();
  return row?.email || '';
}

const mail = (env, m, replyTo) => ({ from: env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, ...(replyTo ? { reply_to: replyTo } : {}) });

export async function send(env, to, message, channel, subject = 'A message from your review') {
  if (channel === 'sms') {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: message }),
    });
    if (!res.ok) throw new HttpError(502, `Text not sent (${res.status})`);
    return;
  }
  if (channel === 'email') return sendEmails(env, [{ to, subject, text: message }]);
  throw new HttpError(400, 'No way to send this message. Copy it and send it yourself.');
}

// Many emails in as few calls as possible. list: [{ to, subject, text }]
export async function sendEmails(env, list) {
  if (!list.length) return;
  const replyTo = await directorEmail(env);
  if (env.MAILER) {
    try {
      await env.MAILER.send(list.map((m) => ({ ...m, from: env.EMAIL_FROM, replyTo })));
    } catch (e) {
      throw new HttpError(502, `Email not sent: ${e.message}`);
    }
    return;
  }
  // Resend takes up to 100 per batch.
  for (let i = 0; i < list.length; i += 100) await resend(env, '/emails/batch', list.slice(i, i + 100).map((m) => mail(env, m, replyTo)));
}
