# CLAUDE.md

Build instructions for the huiMAU 360 review app. Read this whole file before writing any code.

## What we are building

A 360 review app for a Native Hawaiian nonprofit (the Hui). The executive director, Noʻeau, runs an annual review where every staff member writes a self reflection and then reviews 1 to 3 coworkers. He used to do this with Google Forms and compile everything by hand. The Hui is now 20 plus people and that broke.

This app replaces the whole process. Staff answer on their phones, by voice or text, online or offline. Noʻeau sets up the cycle, assigns reviewers, watches completion, reads raw responses, and gets AI drafted summaries that mix plain language with direct quotes and are measured against the Hui's own values. The app also runs year round with a mahalo feed, personal goals, and feedback on request, so the annual review is not a once a year scramble.

The owner of this build is Olin Lagon. He is handing the finished app to Noʻeau. Olin is a strong engineer. Do not over explain code to him. Do walk him through every Cloudflare setup step and every secret he has to create, one at a time, and wait for him to confirm each one.

The app is called Hui 360, a generic name chosen by Olin (it replaced the working name Kilo). It is open source in the public GitHub repo olagon/hui-360-review. Keep the name in one config constant so it can be changed. Confirm the final name with Noʻeau before launch.

## Hard rules

- Hosted at huimau.actionsmatter.com. The actionsmatter.com zone is already on Cloudflare.
- The build is 100% Cloudflare. Pages for the frontend, Pages Functions (Workers) for the API, D1 for the database, R2 for voice recordings and exports, Workers AI for transcription and summaries, Cloudflare Access for admin login, Cron Triggers for reminders, KV for rate limiting and short lived tokens if needed. No other hosting, no other database, no Firebase, no Supabase, no Vercel.
- The only outside services allowed are optional and off by default. See the Reminders section.
- Frontend is plain HTML, CSS, and JavaScript. No React, no build step, no bundler. ES modules are fine. Keep it small and fast.
- Mobile first. Most staff will use this on a phone in the field. Test every screen at 375px wide.
- Offline first for the staff side. Service worker plus IndexedDB queue. Nothing a staff member types or records is ever lost because of a dropped signal.
- Never use em dashes or en dashes anywhere in the UI, copy, code comments, or docs. Hyphens are fine.
- Use the ʻokina (ʻ) and kahakō (ā ē ī ō ū) correctly in all Hawaiian words. Never substitute a straight apostrophe for the ʻokina. Load a font that renders them well.
- Footer on every page reads "Open source · MIT license" and "Stewarded by Olin Lagon", with "Open source" linking to the GitHub repo, "MIT license" to its LICENSE file, and "Olin Lagon" to https://www.linkedin.com/in/olinlagon.
- Open source. MIT license. Write the README so another Hawaiian nonprofit could deploy its own copy in an afternoon.
- Everything the Hui enters is theirs. One click full export to JSON and to a folder of Markdown files in R2. No lock in.

## People and roles

- Admin. Noʻeau, plus Olin during setup. Full access. Logs in through Cloudflare Access.
- Lead. Optional role for a program lead who can see summaries for their own team only. Build the role but it can be unused.
- Staff. Everyone else. No password. They get a magic link.
- Community voice. Someone outside the Hui (a partner, a kupuna, a volunteer, a landowner) who is sent a one question link about one staff member. No account.

## Cloudflare architecture

### Project layout

```
/public              static frontend, served by Pages
  /index.html        staff landing (magic link entry)
  /review/           staff review flow
  /me/               staff personal page (goals, timeline, mahalo)
  /admin/            admin app, protected by Access
  /voice/            community voice one question page
  /assets/
  /sw.js             service worker
/functions           Pages Functions (the API)
  /api/...
/migrations          D1 SQL migrations, numbered
/scripts             seed, export, dev helpers
/wrangler.toml
/README.md
/CLAUDE.md           this file
```

### Bindings (wrangler.toml)

- D1 database named `hui360_db`
- R2 bucket named `hui360-media` for voice recordings and exports (R2 names cannot use underscores)
- Workers AI binding `AI`
- KV namespace `hui360_kv` for magic link tokens and rate limits
- Cron trigger Mondays and Fridays at 17:00 UTC (7am Hawaiʻi) for reminders (Olin's call: daily was too much)
- Secrets: `SESSION_SECRET`, `HASH_PEPPER`, and the optional ones listed under Reminders

### Auth

Admin pages under `/admin/*` and `/api/admin/*` sit behind Cloudflare Access with a Google identity provider. Allowed emails are set in Access, not in our code. Start with Olin's email and Noʻeau's email (ask Olin for them). In the Worker, verify the `Cf-Access-Jwt-Assertion` header against the team's public keys on every admin request. Do not trust the header without verifying it.

Staff get a magic link. Admin generates links per person per cycle. A link is a signed token stored in KV with the staff id and cycle id, valid for 60 days, reusable. Opening it sets a cookie session for 30 days. Staff can also ask for a fresh link by typing their phone number or email on the landing page, which triggers a reminder (see Reminders) or shows a message to ask Noʻeau.

Community voice links are single use tokens tied to one staff member and one question.

### Workers AI models

- Transcription: `@cf/openai/whisper-large-v3-turbo` for voice answers. Handles English and does reasonably with Hawaiian words. Always keep the original audio in R2 so a human can fix a bad transcript.
- Summaries and drafting: default to the current Claude Sonnet model through the Anthropic API, routed through Cloudflare AI Gateway so logging and caching stay inside Cloudflare. Secret `ANTHROPIC_API_KEY`. Check the Anthropic docs for the current model string, do not guess. Put the model id in one config constant.
- Fallback: if no `ANTHROPIC_API_KEY` is set, use the best available Llama instruct model on Workers AI. Make this a single switch. Write the prompts so they work on either model, but tune them on Claude since that is what Noʻeau will use.

Never send a response to any model until the reviewer identity has been stripped. The model only ever sees the text, the question, the values rubric, and the name of the person being reviewed.

## Database (D1)

Write migrations in `/migrations`, numbered `0001_init.sql` and up. Core tables:

- `staff` id, name, preferred name, email, phone, role (admin, lead, staff), team, start date, active, language preference (en, haw, both)
- `cycles` id, name, opens at, closes at, status (draft, open, closed, published), values set id
- `questions` id, cycle id, audience (self, peer, upward, community), order, prompt en, prompt haw, kind (story, short, mahalo), required, five minute flag, value id (optional link to a value)
- `assignments` id, cycle id, reviewer id, reviewee id, kind (self, peer, upward), status (not started, in progress, done)
- `responses` id, cycle id, reviewee id, question id, kind, body text, audio key (R2), transcript, language, created at, signed name (null unless reviewer chose to sign a mahalo)
- `response_link` response id, assignment hash. The hash is SHA 256 of assignment id plus `HASH_PEPPER` plus cycle id. This is how we mark an assignment done without storing who wrote which response in plain form. Admin UI never shows this table.
- `values` id, values set id, name haw, name en, olelo noeau, olelo noeau meaning, description, order
- `summaries` id, cycle id, reviewee id, draft (AI), edited (admin), talk story prep, status (draft, ready, shared), shared at
- `employee_reflection` id, summary id, body, created at
- `goals` id, staff id, cycle id, body, status (open, met, carried, dropped)
- `mahalo` id, from id (nullable), to id, body, public flag, created at
- `feedback_requests` id, from id, to id, prompt, response, created at
- `kuleana` staff id, title, responsibilities text, works with (json list of staff ids)
- `community_voices` id, cycle id, reviewee id, token, question, response, who (free text, optional), created at
- `audit` id, actor, action, target, created at. Log every admin read of raw responses and every export.

Keep a `settings` table for things like app name, Hui name, moon calendar on or off, reminder channel, and the five minute mode question count.

## The staff experience

### Landing

Magic link opens straight to the person's dashboard. If they land without a link, a simple page explains what this is and lets them request a link. Bilingual toggle top right (English, ʻŌlelo Hawaiʻi). Remember the choice.

### Dashboard during an open cycle

Shows their list in this order:

1. Self reflection
2. One card per coworker they are reviewing
3. Upward review if assigned

Each card shows progress (3 of 7 answered), a Continue button, and an estimated time. A banner at the top shows the close date and, if the moon calendar setting is on, the Hawaiian moon phase for today (see Moon calendar).

### Answering

One question per screen. Big readable prompt in the chosen language, with the other language in smaller text underneath if they picked "both".

Every answer box has three ways in:
- Type
- Tap the mic and talk. Use MediaRecorder, show a timer, cap at 3 minutes per answer. On stop, upload to R2 and transcribe. Show the transcript in the box so they can fix it. If offline, keep the audio in IndexedDB and transcribe when back online.
- Skip, if the question is not required

Autosave on every keystroke to IndexedDB, sync to the server every few seconds when online. Show a small "saved" or "will sync when online" indicator. Never show a spinner that blocks typing.

Mahalo first. The first question on every peer review is a mahalo question, something like "What are you grateful for about this person this year?" Seed it as the default first peer question. At the end of the mahalo question, offer a checkbox "Sign my name to this mahalo so they know it came from me". Only the mahalo question can be signed. Everything else is anonymous and the UI says so plainly.

Story prompts. Default question kind is "story". The prompt asks for a specific time or moment. Seed questions are listed at the end of this file. Rating scales are allowed but discouraged. If Noʻeau adds a scale question, render it as 5 tappable words, not numbers.

Five minute mode. On the dashboard a button says "I only have 5 minutes". It opens only the questions flagged as five minute questions (admin picks 2 or 3 per audience). When done, the card shows "Quick version done, come back for the rest" and the full set stays available.

### Personal page (/me)

Available year round, not just during a cycle.

- My huli. Their 2 or 3 goals for the year, set after their talk story meeting. They can edit. Past years' goals shown with status.
- My timeline. One row per past cycle. Shows the themes from each shared summary (admin controls what gets shared). Private to the staff member and admin.
- Mahalo I've received. Signed mahalo and public mahalo feed items addressed to them.
- Send a mahalo. Pick a coworker, write a line, choose public (shows on the team mahalo board) or private.
- Ask for feedback. Pick a coworker, write a prompt like "How did Saturday's workday go from your side?", the coworker gets a link and answers in a box. Stored with the asker's cycle record so the annual summary can draw from it.
- My reflection. After a summary is shared, a box to write back. Saved alongside the summary.

### Mahalo board

A public page inside the app (staff login required) showing public mahalo in reverse order. Simple, warm, no likes, no comments. This is the only social feature. Keep it that way.

## The admin experience

Everything under /admin. Desktop first here but must still work on a phone.

### Cycle setup

- Create cycle. Name, open date, close date, which values set to use.
- Questions. Reuse from last cycle with one click. Edit prompts in both languages. Drag to reorder. Flag which are five minute questions. Link a question to a value if it is meant to surface that value.
- Assignments. A grid with staff down the left and reviewers across the top. Tap a cell to assign. Show a count per person so Noʻeau can see at a glance everyone has 1 to 3 reviewers and nobody has zero. Include an "auto fill" button that suggests assignments that spread the load evenly and avoid last year's pairs (do not repeat the same pairs two years in a row). Noʻeau can override anything.
- Upward review. Checkbox per cycle to include an upward review of Noʻeau and any leads, with its own question set.
- Community voices. For any staff member, generate one question links to send to outside people. Admin writes the one question. Links are single use and expire with the cycle.
- Open the cycle. Generates all magic links. Shows a copy all button that produces one text message per person with their name and link, ready to paste into Messages, plus the option to send automatically if a reminder channel is configured.

### While the cycle is open

- Completion dashboard. Per person, per assignment. Color by status. One tap to copy a nudge message for anyone behind.
- Early signals. A quiet panel only admin sees. The app runs a light pass over all responses so far and lists repeated themes that look like burnout, unclear roles, safety concerns, or interpersonal friction, with counts, never names. Treat this as pattern spotting, not surveillance. Say that in the UI.
- Reviewer calibration. Once a reviewer has completed 2 or more reviews, note whether their tone runs generous or critical compared to the group. Show it as a small tag next to raw responses ("this reviewer tends to be generous") so Noʻeau reads with that in mind. Never show it to staff.

### After close

Per staff member, a workspace with three tabs.

1. Raw. Every response about this person, grouped by question, with signed mahalo marked. Audio playback where it exists. Every open of this tab is logged to `audit`.
2. Draft. The AI summary. Regenerate button. Noʻeau edits in place in a plain textarea with autosave. He can highlight any sentence in the Raw tab and click "add as quote" to drop it into the draft.
3. Share. Preview of what the staff member will see. Choose which parts to share (summary, quotes, values reflection, goals prompt). Mark as shared. This also unlocks the staff member's reflection box.

Talk story prep. Next to the draft, a panel with three suggested openers, one thing to celebrate, one tension worth sitting with, one question to ask, and the person's goals from last year if any. Generated from the same context as the summary.

Scheduling. A simple scheduler. Noʻeau enters available blocks, the app lays out all meetings across them and produces an .ics file per meeting and one combined .ics. Do not integrate Google Calendar directly. Keep it Cloudflare only.

### Team and board views

- Team view. Across the whole cycle, what did the Hui do well and where are the shared struggles. Generated by AI from all responses with no names. Noʻeau edits it and can share it with all staff with one click. Staff see it on their dashboard.
- Board report. One page, anonymized, no quotes that could identify anyone. Team health themes, growth themes, participation rate, one or two ideas for leadership. Export to PDF (render HTML to PDF in the browser with print styles, no server side PDF library).

### Kuleana map

Dropped by Olin on 2026-10-12. At about 20 people who see each other every week, a map of who does what was one more thing for Noʻeau to keep up, for little gain. Do not rebuild it. The `kuleana` table stays in the schema and in exports so nothing entered is lost, and Auto fill no longer reads it.

### Values

Admin manages one or more values sets. Each value has a Hawaiian name, English name, an ʻōlelo noʻeau, its meaning, and a short description of what it looks like in this Hui. Values show up in the staff question flow as context, in the summary as section headers, and in the rubric the AI uses.

Seed a sample values set to get started. Tell Olin to confirm these with Noʻeau and replace them with the Hui's own. Do not guess at the Hui's actual values.

Sample set, all from Pukui's ʻŌlelo Noʻeau:

- Laulima. Working together. "ʻAʻohe hana nui ke alu ʻia." No task is too big when done together by all.
- Aloha ʻĀina. Love and care for the land. "He aliʻi ka ʻāina, he kauwā ke kanaka." The land is chief, people are its servants.
- Ma ka hana ka ʻike. Learning by doing. "Ma ka hana ka ʻike." In working one learns.
- Kūlia. Striving. "Kūlia i ka nuʻu." Strive for the summit.
- Pilina. Relationships. "ʻIke aku, ʻike mai, kōkua aku, kōkua mai, pēlā ihola ka nohona ʻohana." Recognize others, be recognized, help others, be helped, that is family life.
- Haʻahaʻa. Humility and openness. "ʻAʻohe pau ka ʻike i ka hālau hoʻokahi." Not all knowledge comes from one school.

## The summarizer

This is the heart of the app. Build it as a single module `functions/lib/summarize.js` with pure functions that take plain data and return text, so it can be tested without the network.

Input for one person: their name, the cycle, the values set, every response about them (self, peer, upward, community voice, plus any mahalo and feedback request answers from the year), last year's summary themes, and last year's goals.

Output, in Markdown:

1. Opening. Two or three sentences, warm, specific, in Noʻeau's voice (plain, kind, direct). Lead with gratitude from the mahalo answers.
2. Mahalo. The strongest two or three mahalo quotes, verbatim, with the signed ones attributed by name if signed.
3. Values. One short section per value in the set. Where the responses show the person living that value, say so with one quote. Where they do not come up, say nothing. Never force a value.
4. Themes. Three to five themes across reviewers. For each, one line of summary and one or two short quotes. If multiple reviewers said the same thing in different words, name it as a shared theme and say how many said it.
5. Growth. Where responses point to something to work on. Honest, specific, never harsh. Pair each with something the person already does well that can help.
6. Since last year. If last year's themes and goals exist, two or three sentences on movement.
7. Questions for your huli. Two or three prompts to help the person write next year's goals.

Rules for the model:
- Quotes must be exact substrings of actual responses. After generation, verify every quoted string exists in the response set. Drop any that do not match and regenerate that section if needed.
- Rewrite any quote that would identify the reviewer by a detail (a date, a place only one person was, a role only one person holds). Replace the identifying detail with brackets, like "[the workday in May]".
- Keep Hawaiian in Hawaiian. Do not translate a Hawaiian quote. Offer an English gloss in brackets only if the staff member's language preference is English only.
- Keep it under 900 words.
- No corporate language. No "leverage", "synergy", "stakeholder", "impactful", "circle back". No bullet lists in the opening. The feel should be a letter from someone who respects you.
- Never mention the number of reviewers for any single quote if that number is 1.
- Write the prompt templates in `functions/lib/prompts/` as plain text files so Noʻeau or Olin can tune them without touching code.

Team view and board report use the same module with different templates. Early signals uses a short classification prompt over each response with a fixed label set.

## Reminders

Default is manual and fully on Cloudflare. The admin Cycles page computes who is behind in the open review each time it loads ("Today's nudges") with one tap copy of each nudge message. Noʻeau sends them himself from his phone. This works on day one with no outside account and needs no cron.

As built: email goes through Cloudflare Email Sending (Workers Paid, actionsmatter.com is onboarded, 200 a day quota). Pages Functions cannot hold a `send_email` binding, so a small Worker, `workers/mailer` (hui360-mailer, no workers.dev URL), holds it and the app calls `env.MAILER.send()` over a service binding. `EMAIL_FROM` in `[vars]` turns email on. Resend (`RESEND_API_KEY`) remains the fallback for orgs on the free plan. The same Worker runs the optional Monday and Friday 7am cron, calling `POST /api/cron/reminders` with a shared `CRON_SECRET`, and does nothing until that secret is set.

Optional, off by default, one secret each:
- Text messages through Twilio. Dropped by Olin on 2026-10-12: the app never sends texts, and no screen or doc should suggest it can. US carriers require business texting registration (10DLC), which is not worth it here. The director can still copy a message and text it from his own phone.
- Email through Resend. Secret `RESEND_API_KEY`. Same behavior by email.

Keep the sending code behind one interface `functions/lib/notify.js` with `send(to, message, channel)` so adding a channel later is one file.

## Moon calendar

Setting, on by default. Compute the lunar age for today in Hawaiʻi time and map it to the 30 Hawaiian moon names. Show the name and a small icon on the staff dashboard and the admin cycle page. When Noʻeau picks cycle dates, show the moon name next to each date. This is a touch, not a feature. Do not build anything else around it.

The 30 names in order from the new moon:
Hilo, Hoaka, Kūkahi, Kūlua, Kūkolu, Kūpau, ʻOlekūkahi, ʻOlekūlua, ʻOlekūkolu, ʻOlepau, Huna, Mōhalu, Hua, Akua, Hoku, Māhealani, Kulu, Lāʻaukūkahi, Lāʻaukūlua, Lāʻaupau, ʻOlekūkahi, ʻOlekūlua, ʻOlepau, Kāloakūkahi, Kāloakūlua, Kāloapau, Kāne, Lono, Mauli, Muku.

Use a plain lunar age calculation, good to within a day is fine. Note in the UI that local practitioners may count differently.

## Language

Every UI string lives in `/public/assets/i18n/en.json` and `haw.json`. Build the English set fully. For the Hawaiian set, do a careful first pass and clearly mark the file with a header comment asking a fluent speaker to review before launch. Do not invent words. Where unsure, leave the English in place and flag it with a `TODO` so nothing wrong ships silently.

Staff can answer questions in either language. Store the detected language on the response. The summarizer keeps Hawaiian quotes in Hawaiian.

## Privacy and trust

Write a plain language privacy page inside the app, in both languages, that says exactly what is stored, who can see what, and how anonymity works. Specifically:

- Reviewer identity is never stored next to a response. The link is a one way hash.
- Admin can see all responses but not who wrote them, except signed mahalo.
- Admin reads of raw responses are logged.
- Audio is kept so transcripts can be corrected, and audio is deleted 90 days after a cycle is published unless admin chooses to keep it.
- All data belongs to the Hui and can be exported or deleted by admin at any time.
- Data lives on Cloudflare's network. Name the region setting used for D1 and R2.

Include a "delete everything from this cycle" admin action with a typed confirmation.

## Offline

Service worker caches the app shell and the current cycle's questions. IndexedDB holds draft answers and queued audio. A sync module retries uploads with backoff. Show a persistent small badge when there are unsynced items. Test by turning off the network mid answer, closing the tab, reopening, and confirming nothing was lost.

## Design

- Warm, calm, lots of white space, large type. This is a tool for reflection, not a form.
- Colors drawn from the land, earth browns, kalo greens, ocean blue as accent, off white background. Pick a palette and write it as CSS variables.
- One typeface that renders ʻokina and kahakō cleanly. Test the glyphs on iOS Safari and Android Chrome before settling.
- No icons that look like corporate HR. No stars, no thumbs up. Mahalo uses a simple kalo leaf or wave mark you draw as inline SVG.
- Light theme only, minimal and professional with a light Hawaiian touch. No dark mode (Olin's call).
- The app mark is the niho ring (`public/favicon.svg`, also the favicon and home screen icon), chosen by Olin. An organization's own logo can be uploaded in admin and shows on the home pages.

## Phases

Build in this order. Get Olin's sign off at the end of each phase before starting the next.

### Phase 1, the core cycle
Auth (Access plus magic links), D1 schema, cycle setup, questions, assignments grid, staff answer flow with typing and voice and offline, completion dashboard, raw responses, AI draft summary with quote verification, edit and share, staff reflection, export. Values set and seed questions. Bilingual UI shell with English complete. Privacy page. This phase alone replaces the Google Form process.

### Phase 2, year round
Personal page with goals and timeline, mahalo feed and board, feedback requests, talk story prep, scheduler with .ics, moon calendar, team view, reminders digest.

### Phase 3, widen the circle
Upward review, community voice links, early signals, reviewer calibration, board report, lead role, optional Resend channel (Twilio dropped), Hawaiian i18n review pass, README for other nonprofits.

All three phases are built, except the Hawaiian i18n review pass, which needs a fluent speaker. Notes on how a few pieces landed:
- Staff pages: `/me/` (letters, huli goals, mahalo, feedback, timeline, and "My team" for leads), `/mahalo/`, `/voice/?t=`. A small nav under the header links them.
- Feedback requests do not send a link. The asker copies a message pointing the coworker to `/me/#feedback`, and the coworker's dashboard shows a card until they answer.
- Community voice links work while the cycle is draft or open, answer once, and show in Raw with the optional "who".
- Early signals run when a cycle closes and on demand from Progress. Reviewer tone comes from the same pass and needs 2 or more peer reviews per reviewer. It shows as a count at the top of Raw ("1 of the people who reviewed Kainoa tends to write more generously"), not as a tag on each answer: per answer tags let the admin line up one reviewer's answers across questions and people, which breaks the anonymity rule. Changed 2026-10-12 after review, and Olin confirmed it.
- Upward review is a checkbox in Setup. Everyone in the cycle reviews staff with role admin, and each person reviews their supervisor (`staff.reports_to`).
- Supervisors (Noʻeau's request, 2026-10-12): the role "lead" is labeled Supervisor (alakaʻi). Each person has `reports_to`. The director shares a letter with the supervisor separately, from the Share tab (`supervisor_body`, `supervisor_shared_at`, migration 0009). Supervisors read those letters on /me/ under My team, never raw answers. Team letters no longer go by Group.
- App name is a setting (`app_name`, huiMAU sets "huiMAU 360"), and an uploaded logo replaces the niho mark in the header. `APP_NAME` in app.js is a live binding. The footer shows `VERSION` from app.js (0.1 and up, one step per release, with a git tag), plus "made with Hui 360" when renamed.
- The scheduler keeps the director's free blocks in the browser (localStorage) and builds .ics files client side.
- The board report lives under the Reports tab (renamed from Team report, Olin 2026-10-12) and prints on its own. Both reports have Copy for a doc or email, which puts HTML and plain text on the clipboard.
- Data is now Settings (Olin, 2026-10-12), in sections: Organization, AI, Automated Emails, Mahalo board, Sample review, Your data (export and audit log).
- AI is optional (Olin, 2026-10-12): `settings.ai = 'off'` turns it off. `completer()` checks it before every model call, and audio is kept but not transcribed, so the server enforces it. In the UI with AI off: the mic is hidden, letters use "Start from the answers" (`answersDraft()` in summarize.js, every answer word for word), team and board reports start from an outline, and prep, signals, and tone are hidden. "Start from the answers" is also offered with AI on.
- The Anthropic key can be pasted in Settings, AI (Olin, 2026-10-12). It is checked with models.list, sealed with AES-GCM under a key derived from SESSION_SECRET (`anthropic_key` in settings, plus `anthropic_last4`), never sent back to the browser, kept out of exports, and audited. An `ANTHROPIC_API_KEY` Cloudflare secret wins if both exist. Rotating SESSION_SECRET means pasting the key again.
- Email provider is chosen in Settings, Automated Emails (Olin, 2026-10-12): `email_provider` is off, cloudflare, or resend, with `email_from`, and a pasted Resend key sealed like the Anthropic key (`resend_key`, `resend_last4`). Cloudflare needs Workers Paid and the MAILER binding. `emailSetup()` in notify.js decides, and falls back to the old EMAIL_FROM, MAILER, and RESEND_API_KEY vars. Test email goes to the signed in admin.
- Footer reads "Stewarded by Olin Lagon" (Olin, 2026-10-12).
- Goals are "Pahuhopu" (Noʻeau, v0.3), the word huiMAU uses. The i18n key stays `me.huli` and the letter heading is "Questions for your pahuhopu".
- AI frame (Noʻeau, v0.3): besides the values, AI reads the organization's description, mission, vision, and goals (`settings.org_about`, `org_mission`, `org_vision`, `org_goals`, in Settings, Mission and goals) for letters, prep, team, and board reports, and each person's job title and position description for letters and prep. Positions reuse the `kuleana` table (`title`, `responsibilities`), edited in People. Upload goes through `POST /api/admin/position-text`, which uses Workers AI `toMarkdown()` for PDF, DOCX, and ODT (no model involved for those) and strips the converter's metadata. The prompts say these describe the work, not performance: only answers are evidence. The model never quotes or restates them, and quote verification would drop any quote taken from them anyway.
- Admins list (Olin, v0.2): `settings.admins` is a JSON list of emails, edited in Settings, Admins (GET/PUT /api/admin/admins, audited). `requireAdmin` in auth.js verifies the Access JWT, then refuses anyone not on the list with a 403. An empty list means Access alone decides, so a fresh install is safe while its Access policy names one email. Once the list is saved, the Access policy is Include: Everyone with One time PIN, and Noʻeau adds admins himself. You cannot remove yourself. `putSettings` ignores `admins`.
- Admin and staff in one (Olin, 2026-10-12): an admin whose Access email matches an active staff email (case-insensitive) is the same person. POST /api/admin/as-staff sets their staff session, with no magic link. Admin shows "My reviews (n)" and a Cycles banner when they have reviews left. Staff pages detect admins through the CF_Authorization cookie (verified in full by /api/admin-status) and show an Admin link. The logo goes to /admin/ inside admin. Sign out on either side clears both. Admins with no staff record see "See the staff side" instead.
- Hawaiian is managed in the app (Olin, 2026-10-12): Settings, Language has "Offer ʻŌlelo Hawaiʻi to staff" (`settings.hawaiian`, off unless set to on, because the UI is mostly untranslated) and a Translations page. Admin translations live in the `translations` table (migration 0008), are served publicly from /api/i18n/haw, and override haw.json. getLang() returns 'en' whenever Hawaiian is off, and the picker and People's Language field are hidden.
- Copy is rhythm-neutral (Olin, 2026-10-12): some organizations review more than once a year, so staff copy says "each review" and "your next review", not "this year". The letter heading is "Since your last review". The seed questions still say "this year" because they are huiMAU's own and admins edit them per review.
- Email (Olin's call, October 2026): Cloudflare Email Sending through the mailer Worker, since Olin is on Workers Paid. Resend stays as the free plan fallback. Each person has a Send email checkbox (on by default). Every staff message (links, nudges, letter ready, team report) has an Email everyone button that sends one Resend batch to people with an address and the box checked, and reports how many were skipped. Lost link requests look people up by email or phone and only ever send by email. Replies go to the first active staff member with role admin (Director) who has an email. There is no setting for it.

## Setup walkthrough for Olin

When you reach deployment, stop and walk Olin through these one at a time. Ask him to confirm each before moving on. Print the exact command or the exact clicks.

1. Create the Pages project and connect the repo. Set the production branch.
2. Add the custom domain huimau.actionsmatter.com and confirm the CNAME in the actionsmatter.com zone.
3. Create the D1 database and run migrations.
4. Create the R2 bucket. Set the 90 day lifecycle rule for the audio prefix.
5. Create the KV namespace.
6. Enable Workers AI on the account.
7. Set up Cloudflare Access. Create the application for huimau.actionsmatter.com/admin and the API admin path. Add a Google identity provider. Add the allowed emails. Copy the team domain and Access AUD into wrangler.toml.
8. Generate `SESSION_SECRET` and `HASH_PEPPER` as long random strings and set them as secrets. Tell him to store them in his password manager because losing `HASH_PEPPER` breaks assignment completion tracking.
9. Ask Olin for an Anthropic API key and set `ANTHROPIC_API_KEY`. Create the AI Gateway in the Cloudflare dashboard and put its id in wrangler.toml. Then the optional ones, Twilio and Resend. Explain each and let him skip those.
10. Seed the sample values and questions. Add Noʻeau as admin in Access and as a staff record with role admin.
11. Run through one fake cycle end to end with three test staff records, then delete it.

## Testing

- Unit tests for the summarizer with fixture responses. Test that quote verification catches a fabricated quote.
- Unit test for the assignment hash and that no table join can recover reviewer identity for a non signed response.
- Unit test for the moon calendar against a few known dates.
- Playwright or a simple scripted test for the offline flow.
- Run tests in a GitHub Action on every push. Pages deploys only when tests pass.

## Seed questions

Self reflection
1. What are you most proud of from this year?
2. Tell me about a time this year you felt most connected to the ʻāina or to the Hui's purpose.
3. What was hardest this year, and what did you learn from it?
4. Where do you want to grow next year?
5. What does the Hui need to do better to support you?

Peer review
1. (Mahalo) What are you grateful for about this person this year?
2. Tell me about a time this person showed up for the team or the ʻāina in a way that stuck with you.
3. What is something this person does that you wish more of us did?
4. Where do you think this person could grow, and how could the Hui help?
5. Is there anything else Noʻeau should know?

Five minute flags: self 1 and 4, peer 1 and 2.

Upward review
1. What does this leader do that helps you do your best work?
2. What is one thing you wish they did differently?
3. Is there something you need from leadership that you are not getting?

Community voice (admin writes one question per link, default)
"You worked with [name] this year. What stood out to you about them?"

## Last word

This app is for people who spend their days caring for land and community. Every screen should feel like it respects their time and their words. When in doubt, make it simpler, warmer, and faster.
