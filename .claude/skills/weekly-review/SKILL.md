---
name: weekly-review
description: Synthesize the past week's daily logs into a weekly digest. Captures patterns, insights, key decisions, and open threads that would otherwise be lost after the 3-day daily log window. Run this every Sunday or on demand.
---

# Weekly Review

Synthesize the past week's daily logs into a weekly digest. This is a compression step — preserve signal that matters over weeks while letting day-to-day detail age off naturally.

## Philosophy

Daily logs are high-fidelity, short-lived. Durable memory (`memory.md`) is identity-level, permanent. Weekly digests fill the gap: medium-detail, medium-duration context that would otherwise be lost after 3 days.

This is not a productivity report. It's pattern recognition. What threads are emerging? What insights felt important but didn't obviously belong in durable memory? What's the shape of the week?

## Steps

1. **Read the past 7 daily logs** from `{{vault_path}}/jpOS/daily-log/`. Files are named `YYYY-MM-DD.md`. Work with what's there if fewer than 7 exist.

2. **Read current `memory.md`** to understand what's already captured durably — don't repeat it.

3. **Synthesize the digest** using the format below. Write it to `{{vault_path}}/jpOS/weekly-digest/{{week_file}}`.

4. **Promote to durable memory** if anything from this week clearly belongs in `memory.md` — new projects, significant life changes, updated preferences, relationship developments. Edit `memory.md` directly. Note what you promoted in the digest.

5. **Do NOT message Justin.** This is background processing. Silent by default.

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

## Promoted to Memory
- What (if anything) was added to memory.md this week, and why
- "Nothing promoted" is fine — not every week has durable-level signal
```

Omit any section that has nothing meaningful to say. A short digest is better than a padded one.

## Guidelines

- **Compress, don't summarize.** "Tuesday was a long screen day, Wednesday felt better after the morning run" is better than listing every log entry.
- **Preserve the embodiment thread.** Physical state observations are exactly the kind of signal that gets lost in the 3-day window. Carry it forward.
- **Name the patterns, not just the events.** "Third week in a row where energy drops on Wednesdays" is more useful than "low energy Wednesday."
- **Be honest about thin weeks.** If there wasn't much signal, write a short digest. Don't manufacture patterns.
- **Gratitude carries forward too.** If moments of joy or appreciation showed up in the logs, note what triggered them.
