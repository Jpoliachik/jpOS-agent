# Skill: Daily Prep Briefing

A short morning brief for Justin, published as a **page** with a one-line Telegram nudge linking to it.

## Vibe

Justin has a hard time starting in the morning. The page exists to ease him in — not to inform, summarize, or impress. Think one tight glance, a little warmth, maybe a little play. Not a digest. Not a dashboard. Definitely not a wall of text.

A great brief might be two cards. A heavy day might warrant a few more. You decide. Trust your read on the day.

The page is the brief. Telegram is just the doorbell — one warm line and the link, never a preview.

---

## Weekday Mode (Monday–Friday)

> Auto-recall is OFF for cron runs. Call `recall` yourself if you want context.

### Get a feel for the day

Pull what you'll actually use; skip what you won't. Common sources:

- `recall` for current projects, open threads, this week's priorities
- Recent `jpOS/daily-log/` entries — what was left mid-flight
- `todoist_list_tasks` (today filter) — focus on real work, not chores
- `gcal_agenda` for the next ~14 hours
- `weather_today`

### Compose the page

You're picking cards from the page schema (`prose`, `list`, `weather`, `quote`, `metric`, `divider`). Plain text inside fields — no markdown, no inline formatting. Use the real card type names exactly.

Things you *might* surface, depending on the day:

- A nudge toward where to start — something specific and grabbable, not vague encouragement
- The day's shape — meetings or blocks, only the ones that actually matter
- Weather, if it's interesting or affects something on the calendar
- A quote, a small observation, a callback to something Justin's been chewing on — only if it actually lands
- Anything else the moment calls for — a metric you noticed in recall, a one-line callback to yesterday, a small wink. Use judgment.

Some days nothing in the inbox or calendar deserves a card. That's fine — one good "start here" can be the whole page. Other days you might want a quote AND a callback. Trust the read.

A little personality is good. Dry humor, a wry aside, an odd quote choice — welcome. Cutesy AI assistant energy — not welcome. Sound like a friend who's already had coffee, not a productivity app.

**One quality check before publishing:** would Justin actually look at this and feel a little pulled forward into the day, or would he scroll past? If it's the latter, cut something.

### Publish

1. Call `publish_page` with:
   - `slug`: `daily-{YYYY-MM-DD}` (today's date in America/New_York)
   - `title`: short, warm title for the day (e.g. `Tuesday, May 26`) — feel free to occasionally do something more interesting if a theme emerges
   - `cards`: in whatever order makes sense for today
   - `ttl_days`: 7

2. Then `message_user` once with a short greeting + URL. No content preview. Vary it. Examples — don't reuse these verbatim every day:
   - `morning ☀️ → {url}`
   - `up and at 'em → {url}`
   - `coffee's on → {url}`

Warm, brief, a little human. No "here's your daily digest" formality. No emoji spam.

---

## Weekend Mode (Saturday–Sunday)

Weekends are for family, rest, and fun. **No page on weekends.** Just a short Telegram message via `message_user` — a brief greeting, maybe one gentle suggestion if a pocket of time opens up. Get him off his phone.
