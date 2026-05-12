---
name: memory-prune
description: Review long-term memory for stale, outdated, or redundant entries and prune them. Run periodically or on demand to keep memory clean and current.
---

# Memory Prune

Review long-term memory and remove or update entries that are stale, outdated, redundant, contradicted, or no longer useful. The memory store's automatic dedup catches the obvious overlaps on write, but it doesn't catch things that have gone stale over time — that's what this skill is for.

## Steps

1. **Sweep recent memories.** Call `list_memories(limit=200)` to get a broad view. Optionally narrow with `source=` or `category=` if you want to focus a pass (e.g. just preferences, or just project-related entries).

2. **Cross-check with recent reality.** Skim the last 1-2 weeks of `jpOS/daily-log/` to ground yourself in what's actually been happening. Old memories about "current" projects, people, or routines may have quietly become stale.

3. **Evaluate each entry.** Flag anything that is:
   - **Stale**: references projects, people, or contexts that are no longer active (haven't appeared in logs or other memories for ~2+ months)
   - **Outdated**: facts that have changed (old project status, shifted goals, abandoned preferences)
   - **Contradicted**: directly conflicts with a newer memory and the newer one is correct
   - **Redundant**: duplicated by another memory that says the same thing more clearly
   - **Too granular**: hyper-specific details from a one-time event that don't need to persist

4. **Act on each flag:**
   - **Update** an outdated fact: `update_memory(memory_id, new_content)` — preferred over delete+rewrite for facts that just changed.
   - **Delete** stale, contradicted, or redundant entries: `forget(memory_id)`.
   - **Leave alone** anything you're not certain about — when running in the background, default to keeping.

5. **Report what you did** (see Autonomy section).

## Autonomy

**Mid-conversation (Justin is present):**
- Ask clarifying questions for entries you're genuinely unsure about: "Is [project] still active?" or "You mentioned [X] a while back, still relevant?"
- Be more aggressive — you can verify with him in real time.
- Message Justin with a brief summary at the end: "Pruned 12 memories. 8 stale project entries from [project], 3 outdated preferences, 1 contradiction. Updated 4 others."

**Background / cron (no active conversation):**
- Do NOT message Justin. Silent processing.
- Be **conservative** — when in doubt, keep it. A slightly bloated the memory store is better than accidentally deleting something that matters.
- Only prune things you're confident are stale: finished projects still appearing as active, people/contexts that haven't shown up in logs for months, clearly outdated preferences.
- Append a one-line note to today's daily log so there's a record of what was pruned.

## What NOT to prune

- **Identity-level facts** (personality, core preferences, long-term goals) — even if not recently referenced.
- **Relationship context** (who people are, how Justin relates to them) — unless you're confident the relationship is no longer relevant.
- **Project routing info** (which vault note, which repo, which Linear workspace) — even for paused projects, keep it until the project is explicitly archived.
- **Anything pre-2026-05** that came from the initial migration of `memory.md` — these were promoted to the memory store with intent; don't second-guess them in early passes.
- **Anything you're unsure about** — when running in background, always err on the side of keeping.
