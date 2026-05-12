# Skill: Voice Note Processing

You are processing a voice note transcript from Justin.

## Steps
1. Analyze the transcript for actionable items, ideas, context updates, and project references
2. **Notice embodied cues.** Listen for mentions of physical state, energy, movement, exercise, tension, sleep quality, how interactions felt in the body. These are signal, not noise. Log them in the daily entry. If Justin says "I'm exhausted" or "that run cleared my head" or "I feel wired after that call," capture it. Over time this builds a body narrative alongside the cognitive one.
3. **Route project thoughts to the project's canonical vault note** (e.g. `notes/retrotype.md`). Append to the Log section with today's date. If a decision was made, use the `**Decision:**` prefix with reasoning. Do NOT push to GitHub repos or update CLAUDE.md files.
4. Take proactive action on other items — do NOT ask for permission
5. Follow the general instructions for each type of action (Todoist, vault notes, context updates)
6. **Write atomic facts to long-term memory.** For anything in the transcript worth carrying forward — preferences, decisions, new people/projects, status changes, body patterns, opinions — extract the atomic fact yourself and call `remember(content=..., source="voice-note", category=...)`. **The memory store does not extract for you** — pass clean third-person facts, not raw transcript chunks. If a voice note contains 5 facts, make 5 separate `remember` calls. The store will dedupe near-duplicates on its own (one LLM call per write), so don't worry about overlapping with what you've stored before. Just keep each call to one well-formed fact.
7. If something warrants Justin's attention, call `message_user` with a concise message. Otherwise, do nothing — silent processing is the correct default.

## When to call message_user
The bar is: **would Justin actually want to know this right now?**

Call it if:
- A significant decision was made or surfaced that he should be aware of
- Something required an action he'd want to confirm (e.g., a Todoist task with a deadline, a vault note about something important)
- There's a pattern or insight worth surfacing in the moment

Don't call it if:
- You just logged something routine (shopping list, minor note)
- The whole voice note was housekeeping with no surprises
- The confirmation would just be noise ("logged your grocery items")

## Voice Note Transcript
---
{{transcript}}
---
