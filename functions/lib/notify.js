// Optional sending. Off unless secrets are set.
//   Email: RESEND_API_KEY, and the from address in the RESEND_FROM variable
//   Text:  TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM
import { HttpError } from './http.js';

export const channels = (env) => ({ sms: !!(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM), email: !!(env.RESEND_API_KEY && env.RESEND_FROM) });

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
const mail = (env, m, replyTo) => ({ from: env.RESEND_FROM, to: [m.to], subject: m.subject, text: m.text, ...(replyTo ? { reply_to: replyTo } : {}) });

export async function send(env, to, message, channel, subject = 'A message from your review', replyTo = '') {
  if (channel === 'sms') {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_SID}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`${env.TWILIO_SID}:${env.TWILIO_TOKEN}`)}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: message }),
    });
    if (!res.ok) throw new HttpError(502, `Text not sent (${res.status})`);
    return;
  }
  if (channel === 'email') return resend(env, '/emails', mail(env, { to, subject, text: message }, replyTo));
  throw new HttpError(400, 'No way to send this message. Copy it and send it yourself.');
}

// Many emails in as few calls as possible. Resend takes up to 100 per batch. list: [{ to, subject, text }]
export async function sendEmails(env, list, replyTo = '') {
  for (let i = 0; i < list.length; i += 100) await resend(env, '/emails/batch', list.slice(i, i + 100).map((m) => mail(env, m, replyTo)));
}
