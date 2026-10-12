// The app's mail room. Pages Functions cannot hold Cloudflare's send_email binding,
// so the app reaches this Worker through a service binding (MAILER) and calls send().
// It also wakes the app on Monday and Friday mornings, 7am Hawaiʻi time, for the optional reminders.
import { WorkerEntrypoint } from 'cloudflare:workers';

export default class Mailer extends WorkerEntrypoint {
  // list: [{ to, from, subject, text, replyTo }]. One message per person, so nobody sees anyone else's link.
  async send(list) {
    let sent = 0;
    for (const m of list) {
      try {
        await this.env.EMAIL.send({ to: m.to, from: m.from, subject: m.subject, text: m.text, ...(m.replyTo ? { replyTo: m.replyTo } : {}) });
        sent++;
      } catch (e) {
        // Stop at the first failure and say how far it got, so the director knows who still needs a message.
        throw new Error(`${e.code || 'E_SEND'}: ${e.message} (${sent} of ${list.length} sent)`);
      }
    }
    return sent;
  }

  async scheduled(event, env, ctx) {
    if (!this.env.CRON_SECRET) return; // morning reminders are off until a CRON_SECRET is set here and on Pages
    const r = await fetch(`${this.env.APP_URL}/api/cron/reminders`, { method: 'POST', headers: { 'x-cron-secret': this.env.CRON_SECRET } });
    console.log('reminders', r.status, await r.text());
  }
}
