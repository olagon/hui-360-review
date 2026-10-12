// Optional sending, chosen in Settings, Automated Emails.
//   Email: 'cloudflare': Cloudflare Email Sending through the hui360-mailer Worker (MAILER service binding).
//            Needs the Workers Paid plan ($5 a month).
//          'resend': Resend, free up to 3,000 emails a month. Its key is pasted in Settings and sealed.
//          'off': the director copies each message and sends it.
//   Text:  TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM
// Older setups that only set EMAIL_FROM and RESEND_API_KEY or MAILER as Cloudflare vars keep working.
import { HttpError } from './http.js';
import { unseal } from './seal.js';

export async function emailSetup(env) {
  const rows = env.DB ? (await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('email_provider', 'email_from', 'resend_key')").all()).results : [];
  const s = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const from = s.email_from || env.EMAIL_FROM || '';
  const resendKey = env.RESEND_API_KEY || (s.resend_key ? await unseal(env, s.resend_key, 'resend-key') : '');
  const provider = s.email_provider || (env.MAILER && from ? 'cloudflare' : resendKey && from ? 'resend' : 'off');
  const ready = !!from && ((provider === 'cloudflare' && !!env.MAILER) || (provider === 'resend' && !!resendKey));
  return { provider, from, resendKey, ready, mailer: !!env.MAILER };
}

export const channels = async (env) => ({
  sms: !!(env.TWILIO_SID && env.TWILIO_TOKEN && env.TWILIO_FROM),
  email: (await emailSetup(env)).ready,
});

// Email goes only to people with an address and Send email checked in People. Text is the fallback when Twilio is set up.
export const emailOf = async (env, person) => ((await channels(env)).email && person.email && person.send_email ? person.email : null);
export async function route(env, person) {
  const email = await emailOf(env, person);
  if (email) return { channel: 'email', to: email };
  if ((await channels(env)).sms && person.phone) return { channel: 'sms', to: person.phone };
  return null;
}

const resend = async (key, path, payload) => {
  const res = await fetch(`https://api.resend.com${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new HttpError(502, `Email not sent: ${(await res.text()).slice(0, 200)}`);
};

// Replies reach a person: whoever is marked Director in People.
export async function directorEmail(env) {
  const row = await env.DB?.prepare("SELECT email FROM staff WHERE role = 'admin' AND active = 1 AND TRIM(COALESCE(email, '')) != '' ORDER BY id LIMIT 1").first();
  return row?.email || '';
}

const mail = (from, m, replyTo) => ({ from, to: [m.to], subject: m.subject, text: m.text, ...(replyTo ? { reply_to: replyTo } : {}) });

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
  const setup = await emailSetup(env);
  if (!setup.ready) throw new HttpError(400, 'Email is not set up yet. Copy the messages instead.');
  const replyTo = await directorEmail(env);
  if (setup.provider === 'cloudflare') {
    try {
      await env.MAILER.send(list.map((m) => ({ ...m, from: setup.from, replyTo })));
    } catch (e) {
      throw new HttpError(502, `Email not sent: ${e.message}`);
    }
    return;
  }
  // Resend takes up to 100 per batch.
  for (let i = 0; i < list.length; i += 100) await resend(setup.resendKey, '/emails/batch', list.slice(i, i + 100).map((m) => mail(setup.from, m, replyTo)));
}
