// Optional sending. Off unless secrets are set. One function, so a new channel is one more branch.
//   Text:  TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM
//   Email: RESEND_API_KEY, and the from address in the RESEND_FROM variable
import { HttpError } from './http.js';

export const channels = (env) => ({ sms: !!(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM), email: !!(env.RESEND_API_KEY && env.RESEND_FROM) });

// Pick the channel for one person: the configured preference, falling back to whatever they have.
export function route(env, person, prefer) {
  const c = channels(env);
  const order = prefer === 'email' ? ['email', 'sms'] : ['sms', 'email'];
  for (const ch of order) {
    if (ch === 'sms' && c.sms && person.phone) return { channel: 'sms', to: person.phone };
    if (ch === 'email' && c.email && person.email) return { channel: 'email', to: person.email };
  }
  return null;
}

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
  if (channel === 'email') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM, to: [to], subject, text: message }),
    });
    if (!res.ok) throw new HttpError(502, `Email not sent (${res.status})`);
    return;
  }
  throw new HttpError(400, 'No way to send this message. Copy it and send it yourself.');
}
