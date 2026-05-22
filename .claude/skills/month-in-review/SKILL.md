---
name: month-in-review
description: Compress the past month's weekly digests into a monthly summary. Captures broader arcs, trends, and shifts that only emerge over weeks. Run on the 1st of each month or on demand.
---

# Month in Review

Compress the past month's weekly digests into a monthly summary. Weekly digests capture week-level patterns; monthly summaries surface the longer arcs — shifts in priorities, progress on multi-week efforts, evolving patterns in energy and embodiment, and themes that recur across weeks.

## Philosophy

This is the third layer of graduated compression:
- **Daily logs** → high fidelity, 3-day window
- **Weekly digests** → patterns and insights, ~4-week window
- **Monthly summaries** → broader arcs and trends, ~3-month window
- **Memory store** (Qdrant, via `remember`/`recall`) → atomic durable facts, permanent and searchable

Each layer compresses further and surfaces what matters at a longer timescale. A monthly summary shouldn't rehash what's in the weekly digests — it should name what only becomes visible when you zoom out.

## Steps

1. **Read the weekly digests for the past month** from `{{vault_path}}/jpOS/weekly-digest/`. Files are named `YYYY-WXX.md`. Read the 4-5 that cover the previous month.

2. **Check the memory store** for what's already captured durably — `recall` relevant topics before promoting anything new, so you don't write duplicates.

3. **Optionally skim daily logs** if a weekly digest references something worth expanding on. Don't read all of them — the weekly digests have already done the compression.

4. **Synthesize the monthly summary** using the format below. Write it to `{{vault_path}}/jpOS/monthly-digest/{{month_file}}`.

5. **Promote to durable memory** by calling `remember` for any atomic facts from this month worth carrying forward — significant life shifts, new long-term goals, changed preferences, relationship developments. One fact per call, third-person, with appropriate `source` and `category`. Note what you promoted.

6. **Consider running a memory prune.** After a month of accumulation, stale entries are more likely. Invoke the `memory-prune` skill if entries in the store feel out of date.

7. **Do NOT message Justin.** This is background processing. Silent by default.

## Summary Format

Write the summary as a markdown file:

```markdown
# Month of YYYY-MM

## Arcs
- Multi-week threads: what started, progressed, shifted, or resolved this month
- Projects that moved meaningfully (not just "worked on X")
- Priorities that shifted and why

## Patterns
- Embodiment and energy trends across the month — what's working, what's draining
- Recurring themes in mood, motivation, or focus
- Anything that showed up 3+ times across weekly digests

## Insights
- Realizations that only emerge at the monthly timescale
- Connections between things that looked unrelated week-to-week
- Shifts in thinking or perspective

## Open Threads
- Multi-week threads still unresolved
- Intentions stated but not acted on across multiple weeks
- Questions that keep surfacing

## Promoted to Memory
- What (if anything) was written to or updated in the memory store
- "Nothing promoted" is fine
```

Omit any section that has nothing meaningful to say. A short summary is better than a padded one.

## Guidelines

- **Name the arcs, not the events.** "Shifting from building features to thinking about distribution" is more useful than "worked on marketing, then content strategy."
- **Track the embodiment thread across weeks.** This is where monthly really shines — a week of low energy could be noise; a month of it is a pattern.
- **Be honest about drift.** If goals stated at the start of the month didn't get attention, name that without judgment. Noticing drift is the whole point.
- **Don't pad thin months.** If it was a quiet month, say so in 5 lines. Not every month has big arcs.
