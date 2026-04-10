---
name: memory-prune
description: Review memory.md for stale, outdated, or redundant entries and prune them. Run periodically or on demand to keep durable memory clean and current.
---

# Memory Prune

Review `memory.md` and remove or update entries that are stale, outdated, redundant, or no longer useful. Memory grows but rarely shrinks — this skill is the counterweight.

## Steps

1. **Read the full `memory.md`** from `{{vault_path}}/jpOS/memory.md`.

2. **Read recent context** — skim the last few weekly digests and daily logs to understand what's current. This helps you judge what's stale vs. what's still active.

3. **Evaluate each section and entry.** Flag anything that is:
   - **Stale**: References projects, people, or contexts that are no longer active
   - **Outdated**: Facts that have changed (e.g., old project status, shifted goals, outdated preferences)
   - **Redundant**: Duplicated information, or things now captured better elsewhere
   - **Too granular**: Details that were useful short-term but don't need to live in durable memory (these belong in weekly digests or daily logs, not memory.md)

4. **Edit memory.md** — remove stale entries, update outdated ones, consolidate redundant sections. Preserve the structure and formatting conventions.

5. **Report what you did** (see Autonomy section below).

## Autonomy

This skill operates differently depending on context:

**Mid-conversation (Justin is present):**
- Ask clarifying questions for entries you're genuinely unsure about — "Is [project] still active?" or "You mentioned [X] a while back, still relevant?"
- You can be more aggressive with pruning when you can verify in real time
- Message Justin with a brief summary of what you pruned and why

**Background / cron (no active conversation):**
- Do NOT message Justin. Silent processing.
- Be **conservative** — when in doubt, keep it. A slightly bloated memory is better than accidentally deleting something that matters.
- Only prune things you're confident are stale: finished projects still listed as active, people/contexts that haven't appeared in logs for months, clearly outdated facts
- Leave a brief note in the daily log about what was pruned, so there's a record

## What NOT to prune

- Identity-level information (personality, core preferences, long-term goals) — even if it hasn't been referenced recently
- Relationship context (people, how Justin relates to them) — unless you're confident the relationship is no longer relevant
- Project routing information — even for paused projects, the routing table should stay until the project is explicitly archived
- Anything you're not sure about — when running in background, always err on the side of keeping
