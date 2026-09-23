# Draft Desk

Turns the notes Meera drops into her Telegram channel into LinkedIn drafts she edits and posts herself.

```
Telegram channel ──webhook──▶ notes (Postgres) ◀── one-time import: Telegram export + Drive drafts
                                   │
         Mon/Wed/Fri cron or /draft: triage scores every note, picks the strongest (or combines two)
                                   │
         per draft: Google Search grounding for one current news angle ─▶ draft with voice spec + fact bank
                                   │
         QA: script checks (punctuation, questions, sentence rhythm, banned words, every number sourced)
             + Gemini judge (colon reveal, "It is" verdict, boundary line, ending, evidence strength)
             score < 8/10 ─▶ one redraft with the failures as feedback
                                   │
         Telegram message with Approve / Redo / Skip  +  dashboard to edit, copy, mark posted
```

Nothing is ever posted automatically.

## Where things live

| | |
|---|---|
| `lib/voice.ts` | The voice spec system prompt (sections 7-11 of the spec) |
| `lib/llm.ts` | Gemini client: JSON output validated with zod, Google Search grounding |
| `lib/qa.ts` | Automated rubric checks 1, 2, 3, 6, 7 |
| `lib/pipeline.ts` | Triage, news search, drafting, judge, redraft loop, Telegram delivery |
| `app/api/telegram` | Bot webhook: channel posts → notes, DMs, `/draft`, `/queue`, buttons |
| `app/api/cron` | Scheduled triage (see `vercel.json`: 07:00 IST Mon/Wed/Fri) |
| `app/api/drafts/[id]/run` | Runs one draft in its own function (up to 300s) |

## Setup

1. **Create the bot.** In Telegram, message @BotFather → `/newbot`. Keep the token.
2. **Deploy to Vercel.** Push this folder to a GitHub repo and import it in Vercel, or run `npx vercel` from here.
3. **Add Postgres.** In the Vercel project: Storage → Marketplace → Neon → connect. That sets `DATABASE_URL`. Tables are created on first request.
4. **Set env vars** (Project → Settings → Environment Variables). See `.env.example`: `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `DASHBOARD_PASSWORD`, `CRON_SECRET`. Redeploy.
5. **Connect the webhook.** Sign in to the dashboard and press **Connect webhook** at the bottom of the Drafts page.
6. **Link Meera.** She messages the bot `/start`. It replies with her user id. Set `TELEGRAM_OWNER_ID` to it.
7. **Link the channel.** Add the bot to her notes channel as an admin (it needs no permissions beyond reading). Forward any channel post to the bot. It replies with the channel id. Set `TELEGRAM_CHANNEL_ID` and redeploy.
8. **Import the backlog** on the Import page: the Telegram Desktop JSON export and the Drive drafts folder.
9. **Fill the fact bank.** Resolve the two contradictions the spec flags, then add the real figures she uses (batch pH, sample sizes, return rates).
10. Press **Pick and draft** to try it.

## Local development

```bash
cp .env.example .env.local   # fill in values
npm run dev
```

The Telegram webhook needs a public https URL, so test the bot against a deployment rather than localhost.

## Notes on the design

- **Supply.** Meera captures about 2-3 notes a week, and the goal is 3 posts a week. The backlog (about 60 notes and 40 drafts) plus combining notes is what makes the target reachable. Triage ranks abandoned drafts first because she already chose those topics.
- **Facts.** A draft may only use numbers from the fact bank, its source notes, or the news item. A news item must come from a Google Search grounding source, and its figures are kept only if they appear on the fetched source page. Check 7 fails any other number.
- **Voice learning.** When Meera edits and approves a draft, her version becomes a style example for the next drafts (the 3 most recent).
- **Model.** Gemini (`gemini-3.6-flash` by default, set `GEMINI_MODEL` to change it). Drafting uses high thinking; triage, news and the judge use low.
