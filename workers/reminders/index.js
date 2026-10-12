// Pages cannot run cron triggers, so this tiny Worker wakes up at 7am Hawaiʻi time
// and asks the app to send reminders. The app does nothing unless a text or email
// channel is set up and chosen in admin, Data.
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      fetch(`${env.APP_URL}/api/cron/reminders`, { method: 'POST', headers: { 'x-cron-secret': env.CRON_SECRET } }).then(async (r) =>
        console.log('reminders', r.status, await r.text()),
      ),
    );
  },
};
