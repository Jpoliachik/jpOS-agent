---
name: weekly-review
description: Synthesize the past week's daily logs into a weekly digest. Captures patterns, insights, key decisions, and open threads that would otherwise be lost after the 3-day daily log window. Run this every Sunday or on demand.
---

# Weekly Review

Synthesize the past week's daily logs into a weekly digest. This is a compression step — preserve signal that matters over weeks while letting day-to-day detail age off naturally.

## Philosophy

Daily logs are high-fidelity, short-lived. The long-term semantic memory store (Qdrant) holds durable atomic facts. Weekly digests fill the temporal gap between them: medium-detail, medium-duration narrative context that would otherwise be lost after the 3-day daily log window.

This is not a productivity report. It's pattern recognition. What threads are emerging? What insights felt important? What's the shape of the week?

## Steps

1. **Read the past 7 daily logs** from `{{vault_path}}/jpOS/daily-log/`. Files are named `YYYY-MM-DD.md`. Work with what's there if fewer than 7 exist.

2. **Synthesize the digest** using the format below. Write it to `{{vault_path}}/jpOS/weekly-digest/{{week_file}}`.

3. **Do NOT promote facts to the long-term memory store from this skill.** That happens naturally via `remember` calls during normal conversation — duplicating it here creates two write paths and confuses dedup. If you notice durable facts you genuinely think haven't been captured, that's a signal to flag in the digest itself (under "Insights" or a `## Not Yet Captured` note) so Justin can decide.

4. **Do NOT message Justin.** This is background processing. Silent by default.

## Digest Format

Write the digest as a markdown file with this structure:

```markdown
# Week of YYYY-MM-DD → YYYY-MM-DD

## Patterns
- Energy, mood, embodiment observations across the week
- What activities/contexts correlated with vitality vs. depletion
- Recurring themes in how the week felt

## Key Decisions & Context
- Decisions made and their reasoning (the "why" ages better than the "what")
- Important conversations or turning points
- Project progress worth remembering

## Insights
- Non-obvious realizations or connections
- Things that felt important in the moment and still feel worth keeping
- Ideas that came up more than once

## Open Threads
- Things mentioned but unresolved
- Questions raised but not answered
- Intentions stated but not yet acted on

```

Omit any section that has nothing meaningful to say. A short digest is better than a padded one.

## Guidelines

- **Compress, don't summarize.** "Tuesday was a long screen day, Wednesday felt better after the morning run" is better than listing every log entry.
- **Preserve the embodiment thread.** Physical state observations are exactly the kind of signal that gets lost in the 3-day window. Carry it forward.
- **Name the patterns, not just the events.** "Third week in a row where energy drops on Wednesdays" is more useful than "low energy Wednesday."
- **Be honest about thin weeks.** If there wasn't much signal, write a short digest. Don't manufacture patterns.
- **Gratitude carries forward too.** If moments of joy or appreciation showed up in the logs, note what triggered them.
