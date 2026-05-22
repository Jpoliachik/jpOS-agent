# Skill: Daily Prep Briefing

You are generating a short morning brief for Justin, published as a **page** with a one-line Telegram nudge linking to it.

## Philosophy
Justin has a hard time starting. The brief exists to remove that friction — not to inform, summarize, or impress. The page should feel like one tight glance: "here's where to start, what's on deck, weather, and something to chew on." Anything that isn't signal gets cut.

**Page length target: 4-5 cards max. If you're adding a fifth, ask whether the fourth deserves to stay.**

---

## Weekday Mode (Monday–Friday)

> **Note on memory:** This skill runs from a cron, which means **auto-recall is OFF**. You must call `recall` explicitly to load context.

### Gathering (do these in parallel where you can)
1. `recall(query="current projects in progress", top_k=10)` and `recall(query="this week commitments and priorities", top_k=10)`
2. Skim the last 1-2 days of `jpOS/daily-log/` for the recent narrative — open threads, what was left unfinished
3. `todoist_list_tasks` (today filter) — work tasks only, skip household chores unless time-sensitive today
4. `gcal_agenda` for the next ~14 hours
5. `weather_today` (no args)

### Deciding what goes on the page

**Card 1 — Start here.** A single text card. One actionable sentence picking the first move of the day. Pull from: yesterday's open threads (preferred when something was clearly left mid-flight), today's most important Todoist task, or a known commitment. Specific over generic — "open the Mitzi auth PR and ship the fix" beats "work on Mitzi." Skip vague encouragement.

**Card 2 — Today's schedule.** A `bullets` card with the real meetings/blocks on today's calendar — formatted as `9:30a — call with X`. Skip all-day events that aren't actionable. If the day is empty, skip this card entirely. Cap at ~5 items; if there are more, only include the ones that actually shape the day.

**Card 3 — Weather.** A short text card. One line, e.g. `62° → 78°, partly cloudy. ☀️ Sunrise 6:14a · Sunset 8:02p.` Use the data from `weather_today`. No commentary.

**Card 4 — Quote.** A `quote` card. Pick a real, verifiable quote from a real person in history — philosophy, literature, science, art, sports, business. Choose it intentionally based on today's context (the start-here task, the day's shape, what Justin's working through). Bias toward less-overused quotes; avoid the same handful of recycled Einstein/Twain/Gandhi lines. **Sanity check before using:** if you're not confident the person actually said it, pick a different one. Better to use a slightly more obscure verified quote than a famous one you're uncertain about.

### Publishing

1. Call `publish_page` with:
   - `slug`: `daily-{YYYY-MM-DD}` (today's date in America/New_York)
   - `title`: a short, warm title for the day, e.g. `Thursday, May 22`
   - `subtitle`: optional, skip unless it adds something
   - `cards`: the 3-4 cards above, in order
   - `ttl_days`: 7

2. Then call `message_user` exactly once with a short greeting + the page URL. No preview of contents — the page is the contents. Examples of good messages:
   - `morning ☀️ → {url}`
   - `up and at 'em → {url}`
   - `good morning. today's brief: {url}`

Keep it warm and brief. No emoji spam. No "here's your daily digest" formality.

---

## Weekend Mode (Saturday–Sunday)

Weekends are for family, rest, and fun. **Do not publish a page on weekends.** Send a single short Telegram message via `message_user` — a brief greeting, maybe one gentle suggestion if a pocket of time opens up. Get him off his phone.
