<img src="public/favicon.svg" width="72" height="72" alt="Hui 360 niho ring logo">

# Hui 360

[![Hui 360 in about a minute: open source, free, inspired by huiMAU](docs/hui-360-overview.gif)](docs/hui-360-overview.mp4)

*Hui 360 in about a minute. Click for the [full quality video](docs/hui-360-overview.mp4). Every copy of the app also plays it at `/tour/`. For directors, a 90 second walkthrough of running a review start to finish: [video](docs/hui-360-admin-walkthrough.mp4), or `/tour/admin/` in the app.*

**An open source 360 review app for nonprofits and small teams.** Staff answer on their phones, by voice or by typing, with or without a signal. Answers stay anonymous. At the end, the director gets an AI drafted letter for each person, written from exact quotes and measured against the organization's own values.

Open source under the [MIT license](LICENSE). Free to use, copy, and change. Runs entirely on Cloudflare, and for a team of 20 it costs a few dollars a year (see [What it costs](#what-it-costs)).

The mark is a niho ring: the niho (triangle) pattern from kapa, turned into a circle that points inward to one person, the way a 360 review gathers many voices around one.

Built with Hawaiian organizations in mind: the interface works in English, ʻŌlelo Hawaiʻi, or both, renders the ʻokina and kahakō properly, and keeps Hawaiian quotes in Hawaiian. It works just as well for any team that wants reviews to feel like reflection instead of paperwork.

## Mahalo nui loa to huiMAU

This app exists because of [huiMAU](https://www.alaulili.com) (Hui Mālama i ke Ala ʻŪlili), a community nonprofit in Hāmākua on Hawaiʻi Island. Their staff 360 does more than grade people. It seeks out each person's gifts, holds everyone to aloha, pilina, and kūʻokoʻa, and asks them to give honest feedback with an open heart. When they outgrew compiling it all by hand, the work of building something better began, and every screen here was shaped by how they care for one another and for the ʻāina. Mahalo to Noʻeau and the whole huiMAU ʻohana for the inspiration, the trust, and the example. Anything good in this app is theirs. The mistakes are ours.

## What it does

**For staff**
- A personal link, no password, no app to install. It opens straight to their list: a self reflection, then a card for each coworker they review.
- One question per screen. Type, or tap **Talk** and speak for up to 3 minutes. The recording turns into text they can fix.
- Works offline. Every keystroke is saved on the phone first, so a dropped signal or a closed tab never loses a word. It syncs when the signal comes back.
- **I only have 5 minutes** opens just the quick questions.
- Every peer review starts with **mahalo**. Only the mahalo can be signed, and only if the writer chooses to. Everything else is anonymous, and the screen says so.
- After the review, they read the summary written for them and can write a reflection back.
- All year, on **My page**: their two or three goals (my huli), a timeline of past letters, mahalo they received, a way to send a mahalo, and a way to ask a coworker for feedback on something specific. Answers to those asks feed next year's letter.
- A **mahalo board** of public thanks, and a **kuleana map** of who does what. No likes and no comments.

**For the director (admin)**
- Add staff, set your values, create a cycle, and edit questions in both languages with drag to reorder.
- Assign reviewers on a simple grid, or press **Auto fill** to pair people who work together and avoid repeating last year's pairs.
- Open the cycle and copy one ready to send text message per person with their link.
- Watch completion, and copy a gentle nudge for anyone behind. The admin home lists today's nudges.
- **Early signals:** counts of answers that sound like burnout, unclear roles, safety concerns, or friction. No names, no quotes. Pattern spotting, not surveillance.
- **Community voices:** a one question link for a partner, kupuna, or volunteer outside your organization. Single use, no account.
- **Upward review:** a checkbox per cycle adds a review of the director and team leads.
- After the cycle closes: read every answer about a person (each read is logged), play recordings, generate an AI draft, edit it, choose which parts to share, and share it. A quiet note says when some of a person's reviewers run notably generous or critical, without ever saying which answers are theirs.
- **Talk story prep** for each meeting (openers, something to celebrate, a tension, a question, last year's goals), and a **scheduler** that lays every meeting into your free time and makes calendar files.
- A **team report** for staff and a one page **board report** with no names and no quotes.
- A **kuleana map** you keep up to date, which Auto fill uses to pair coworkers.
- A **lead** role: someone marked lead reads the shared letters of their own team.
- Email everyone their link, a nudge, or "your letter is ready" in one click, through Cloudflare Email Sending or a free Resend account. A Send email checkbox per person decides who gets email. Optional texts through Twilio, and an optional 7am reminder for anyone behind.
- A Hawaiian moon name for today and next to review dates. Turn it off in Data.
- Export everything to JSON and Markdown at any time. Delete a whole cycle by typing its name.

## How anonymity works

An answer is stored with the person it is about, never with the person who wrote it. To track who has finished, the app stores a one way hash of the assignment and a secret key (`HASH_PEPPER`) that lives only in Cloudflare's secret store, never in the database. Anyone holding the database, or an export (which leaves the hash out entirely), cannot work back from an answer to its writer.

On top of that: answer ids are random, dates have no times, raw answers open only after a cycle closes and are shuffled within each question, the completion screen shows status only, and the AI only ever sees the words, the question, your values, and the name of the person being reviewed. The test in `test/assign.test.js` checks that no table join can recover a writer.

The in app privacy page states the honest limits too: if only one coworker reviews someone, the director knows whose answers those are.

## What it costs

Estimates from Cloudflare's and Anthropic's published prices as of October 2026, for a team of **20 people**, one review cycle a year, each person writing a self reflection and reviewing 2 coworkers, with about 10 minutes of spoken answers per person.

| Piece | What it does | Typical cost |
|---|---|---|
| Cloudflare Pages, Functions, D1, R2, KV | The app, its database, recordings, and links | **$0** on the free plan (far under 100,000 requests a day, 5 GB of database, 10 GB of files) |
| Cloudflare Access | Admin sign in with Google or a one time code | **$0** for up to 50 users |
| Workers AI, Whisper | Voice to text, about 200 minutes a cycle | **$0**, inside the free 10,000 daily neurons (about 200 minutes a day). Beyond that, $0.0005 a minute |
| Llama 3.3 70B on Workers AI (no key needed) | Drafting each person's letter | **About $0.005 a person**, usually inside the free daily allowance, so **$0** |
| or Claude Haiku 5.5 (the default when you add an Anthropic key) | Drafting, with better writing | **About $0.002 to $0.005 a person**, under $0.25 a cycle |
| or Claude Sonnet 5.5 (one line in `functions/lib/config.js`) | Drafting, richest letters | **About $0.05 to $0.10 a person**, $1 to $2 a cycle |
| Email (optional) | Emailing links, nudges, and letters | **$0**: included in Workers Paid, or Resend's free plan up to 3,000 a month |
| Domain | Your web address | **$0** with your own domain or the free `pages.dev` address, about $10 a year otherwise |

**Typical total: $0 to $1 a year.** Without an Anthropic key everything still works, drafts included, on Cloudflare's free allowance. Prefer to write every letter by hand? Use "Start a blank draft" and skip AI entirely.

When you might pay more:
- **Cloudflare Workers Paid, $5 a month**, if you outgrow the free daily limits (a large organization, lots of voice on the same day) or long recordings hit the free plan's 10 ms CPU limit.
- **More people.** At 100 staff, plan on about $0.50 a cycle with Haiku or $5 to $10 with Sonnet. Hosting usually stays free.
- **Anthropic** bills by usage from prepaid credit, so add a few dollars to start.

Current prices: [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [Workers AI](https://developers.cloudflare.com/workers-ai/platform/pricing/), [Anthropic](https://www.anthropic.com/pricing).

## Set it up for your organization

Plan on an afternoon. You need:
- A Cloudflare account (free). A domain on Cloudflare is nice but optional.
- A GitHub account, and Node 22 or newer on your computer.
- Optional: an Anthropic API key for the best summaries.

### 1. Get the code

Fork this repository on GitHub, then:

```bash
git clone https://github.com/<you>/hui-360-review.git
cd hui-360-review
npm install
npx wrangler login
```

### 2. Create the Cloudflare pieces

```bash
npx wrangler d1 create hui360_db --location wnam
npx wrangler r2 bucket create hui360-media --location wnam
npx wrangler r2 bucket lifecycle add hui360-media audio-90-days audio/ --expire-days 90
npx wrangler kv namespace create hui360_kv
npx wrangler pages project create hui-360 --production-branch main
```

Paste the D1 `database_id` and the KV `id` into `wrangler.toml`. If you named the Pages project something else, change `name` there too. `wnam` (Western North America) is the closest region to Hawaiʻi. Pick another if you are elsewhere.

### 3. Set the secrets

Make two long random strings (`openssl rand -base64 48` twice) and save them in your password manager. **Losing `HASH_PEPPER` breaks completion tracking for any open cycle.**

```bash
npx wrangler pages secret put SESSION_SECRET --project-name hui-360
npx wrangler pages secret put HASH_PEPPER --project-name hui-360
```

### 4. Protect the admin pages with Cloudflare Access

In the Cloudflare dashboard, open **Zero Trust**:
1. **Settings, Authentication:** add a login method, either Google or One time PIN.
2. **Access, Applications, Add an application, Self hosted.** Add two public hostnames: your domain with path `admin` and your domain with path `api/admin`.
3. Add a policy that allows only your admins' email addresses.
4. Copy the **Application Audience (AUD) tag** into `ACCESS_AUD` in `wrangler.toml`, and your team domain (`https://<team>.cloudflareaccess.com`) into `ACCESS_TEAM_DOMAIN`.

The app checks the Access token's signature on every admin request. It never trusts the header alone.

### 5. Choose how summaries are written

- **Claude:** create an AI Gateway in the Cloudflare dashboard (AI, AI Gateway). Put its id in `AI_GATEWAY_ID` and your account id in `CF_ACCOUNT_ID` in `wrangler.toml`, then `npx wrangler pages secret put ANTHROPIC_API_KEY --project-name hui-360`.
- **Llama:** do nothing. Without an Anthropic key, drafts come from Llama on Workers AI.
- With a key, drafts use Claude Haiku 5.5. For richer letters at about 20 times the cost, set `CLAUDE_MODEL` to `claude-sonnet-5-5` in `functions/lib/config.js`.

### 6. Recommended: email

Without email, the app sends nothing. Your director copies each link, nudge, and "your letter is ready" message and sends it from their own phone. That works, but with 20 people it is a lot of pasting.

With email on, every one of those messages has an **Email everyone** button. It emails each person who has an address and **Send email** checked in People (checked by default), and tells the director how many it skipped so they can copy those few by hand. A staff member who loses their link can type their email or phone number on the home page, and the app emails them a fresh one. The phone number is only used to look them up.

There are two ways to send it.

**If your Cloudflare account is on Workers Paid ($5 a month), use Cloudflare Email Sending.** No other account needed. It is in beta as of October 2026, and new accounts start at 200 emails a day, which covers a review for a team of 20.
1. In the dashboard, **Compute, Email Service, Email Sending, Onboard Domain**, and pick your domain. Cloudflare adds the DNS records. Wait until it says Configured.
2. Deploy the mailer Worker. Pages Functions cannot hold Cloudflare's email binding, so this small Worker holds it, and the app calls it through a service binding:
   ```bash
   npx wrangler deploy -c workers/mailer/wrangler.toml
   ```
3. In `wrangler.toml`, set `EMAIL_FROM` under `[vars]` to an address on that domain, like `"Your Org <review@your-org.org>"`, keep the `[[services]]` block for `MAILER`, and deploy.

**On Cloudflare's free plan, use [Resend](https://resend.com)**, free up to 3,000 emails a month.
1. Make a free Resend account, then **Domains, Add domain** and add the DNS records it gives you. Wait for Verified.
2. **API Keys, Create API key** with sending access, then run this and paste the key when asked:
   ```bash
   npx wrangler pages secret put RESEND_API_KEY --project-name hui-360
   ```
3. In `wrangler.toml`, set `EMAIL_FROM` to an address on your verified domain, delete the `[[services]]` block for `MAILER`, and deploy.

Either way, finish in admin, **Data, Email**: put your director's address in **Replies go to**, so replies reach a person.

**Texts are optional.** With Twilio (`TWILIO_SID`, `TWILIO_TOKEN`, and `TWILIO_FROM` as Pages secrets, about $0.01 a text), single messages and morning reminders go by text to people the app cannot email.

**Morning reminders are optional.** Pages cannot run on a schedule, so the mailer Worker also wakes the app at 7am Hawaiʻi time. Change `APP_URL` in `workers/mailer/wrangler.toml` to your address, deploy it (even on the free plan, where it only does this), make one more random string, and set it in both places:

```bash
npx wrangler pages secret put CRON_SECRET --project-name hui-360
npx wrangler secret put CRON_SECRET -c workers/mailer/wrangler.toml
```

Then in admin, Data, Email, check the morning reminder box.

### 7. Deploy

In your GitHub repository, add two secrets under **Settings, Secrets and variables, Actions**:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`: create it from the "Edit Cloudflare Workers" template, then add **Cloudflare Pages: Edit**, **D1: Edit**, and **Workers AI: Edit**.

Commit your `wrangler.toml` changes and push to `main`. The workflow runs every test, applies database migrations, and deploys only if everything passes. Then, in the Pages project, add your custom domain.

### 8. Make it yours

Open `https://<your domain>/admin/` and sign in.
1. **Data, Settings:** enter your organization's name and what staff call your director. Staff see both, and summary drafts are written in the director's voice. Upload your logo there too (an animated SVG works); it shows on the staff and admin home pages.
2. **Values:** replace the sample set (from Pukui's ʻŌlelo Noʻeau) with your own values. Each value has a name, an optional ʻōlelo noʻeau, and what it looks like in your organization. The AI measures summaries against these.
3. **People:** add everyone, with a phone or email so you can send links.
4. **Kuleana:** add each person's title, what they take care of, and who they work with most.

### 9. Run a practice cycle

Add three test people, create a cycle, open it, answer as each of them from their links (try airplane mode halfway through), close it, draft a summary, share it, then delete the cycle. Now you know every step before your team does.

## A review cycle, start to finish

1. **Add your people** once, in People. Staff, interns, volunteers, and board members all go here. Paste a list to add many at once.
2. **Create the cycle** with open and close dates. Questions copy from your last cycle, or from the starter set the first time. A banner at the top of every cycle says what to do next.
3. **Choose who takes part** in the cycle's People tab. Everyone active starts checked. You can also add someone new right there.
4. **Tune the questions.** Story questions ("tell me about a time...") give far better answers than ratings. Flag 2 or 3 per group as five minute questions.
5. **Pick reviewers** in the Reviewers tab. Aim for 2 or 3 per person. Auto fill gets you most of the way.
6. **Open it** and send each person their message from the Links tab.
7. **Nudge** from the Progress tab as the close date gets near.
8. **Close it.** Answers lock, and the Letters tab opens.
9. **Write the letters.** For each person, read every answer about them, let AI compile a draft that summarizes what was sent, write your final version, and share the parts you choose. Print or save any letter as a PDF.
10. **Write the team report and the board report** in the Team report tab.
11. **Talk story.** Lay out the meetings in the Talk story tab and send calendar files. Open each person's Draft tab for talk story prep. They read their letter on their phone and can write a reflection back, then set their goals on My page.
12. **Mark it published** once every letter is shared, and export a copy for your records.

Want to see the end result first? In Data, load the sample review: three made up people, their answers, a finished letter, and a reflection.

## Local development

```bash
cp .dev.vars.example .dev.vars   # DEV_ADMIN_EMAIL lets /admin work on localhost without Access
npm run dev                      # http://localhost:8790
npm test                         # summarizer, anonymity, auth, moon, calendar files, signals
npm run e2e                      # offline flow in a real browser
```

Workers AI always runs remotely, even in local dev, so voice and Llama drafts need `wrangler login`.

## Customize

- **Name:** `APP_NAME` in `public/assets/app.js`.
- **Summary prompts:** plain text files in `functions/lib/prompts/`. Edit them without touching code. Every quote in a draft is checked word for word against the answers, and any that do not match are removed.
- **Models:** `functions/lib/config.js`.
- **Words on screen:** `public/assets/i18n/en.json` and `haw.json`. The Hawaiian file is a first pass, and every key in its `_todo` list still shows English. Please have a fluent speaker fill those in rather than guessing.
- **Colors:** CSS variables at the top of `public/assets/style.css`.

## Built with

Plain HTML, CSS, and JavaScript, no framework and no build step. Cloudflare Pages, Pages Functions, D1, R2, KV, Workers AI, AI Gateway, and Access. Claude by Anthropic for summaries. Inter for type, chosen because its ʻokina is a real, spaced glyph. Inter is licensed under the SIL Open Font License (`public/assets/fonts/OFL.txt`).

## Contributing

Issues and pull requests are welcome, especially Hawaiian translations, accessibility fixes, and stories from organizations using it. Please keep it simple, fast, and kind to people on slow phones.

## License

[MIT](LICENSE). Courtesy [Olin Lagon](https://www.linkedin.com/in/olinlagon).
