---
name: project-status
description: Check the current state of a project by pulling from all available sources — GitHub repo, vault notes, memory, Linear. Use when asked "how's [project] doing?" or when you need project context.
argument-hint: "[project-name]"
---

# Project Status

Pull the current state of a project from all available sources and synthesize a status snapshot.

## Steps

1. **Identify the project.** Use `$ARGUMENTS` if provided, or infer from conversation context.

2. **Pull what the memory store knows about the project first.** Routing info (vault note path, repo, Linear workspace) and recent state live here:
   - `recall(query="<project name> routing canonical note repo workspace", category="project", top_k=10)` — gets routing + structural info
   - `recall(query="<project name> current status recent activity decisions", top_k=15)` — gets recent state, decisions, blockers
   - If the memory store returns nothing useful, the project hasn't been captured yet — ask Justin and then `remember` what he tells you so the next call is easier.

3. **Gather from external sources** (use the routing info from step 2; check each, skip what doesn't exist):

   **Obsidian vault:**
   - Read the project's canonical note (path from the memory store)
   - Check the "Current Thinking" and "Log" sections for recent state

   **GitHub:**
   - If a repo exists, use `gh` CLI:
     - `gh repo view <owner/repo>` — description, recent activity
     - Read the repo's `CLAUDE.md` or `README.md` for project overview
     - `gh issue list` — open issues
     - `gh pr list` — open PRs
   - A quick pulse, not a full audit

   **Linear:**
   - If the project has a Linear workspace/project, check recent issues and status

   **Daily logs:**
   - Skim last 1-2 weeks of `jpOS/daily-log/` for narrative mentions

4. **Synthesize a status snapshot.** Keep it concise and useful:
   - What's the current state? (active, paused, shipping, blocked, etc.)
   - What's been happening recently?
   - What are the open threads or next steps?
   - Any decisions pending or blockers?

## Output

When mid-conversation, deliver the status directly in your response. Format naturally — don't force a rigid template. The goal is to answer "how's this project doing?" in a way that's immediately useful.

If something is unclear or you're curious about context you can't find, ask. Justin often has context that isn't written down yet — asking surfaces it and creates an opportunity to capture it.

## Notes

- Not every project has every source. A hobby shader project won't have Linear issues. A work project might not have a vault note yet. Work with what's available.
- If you can't find the project at all, say so and ask Justin for pointers — this signals that the routing info isn't in the memory store yet.
- When you discover new project info (a repo URL, a status change, a new link), call `remember(content=..., source=..., category="project")`. Don't wait for permission — the memory store dedupes so over-writing is cheap.
