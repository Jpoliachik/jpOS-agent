---
name: project-status
description: Check the current state of a project by pulling from all available sources — GitHub repo, vault notes, memory, Linear. Use when asked "how's [project] doing?" or when you need project context.
argument-hint: "[project-name]"
---

# Project Status

Pull the current state of a project from all available sources and synthesize a status snapshot.

## Steps

1. **Identify the project.** Use `$ARGUMENTS` if provided, or infer from conversation context. Check `memory.md` for the project routing table — it maps project names to vault notes and external sources.

2. **Gather from all available sources** (check each, skip what doesn't exist):

   **Obsidian vault:**
   - Read the project's canonical note (from the routing table in memory.md)
   - Check the "Current Thinking" and "Log" sections for recent state

   **GitHub:**
   - If a repo exists, use `gh` CLI to check:
     - `gh repo view <owner/repo>` — description, recent activity
     - Read the repo's `CLAUDE.md` or `README.md` for project overview (use `gh api` or clone if needed)
     - `gh issue list` — open issues, recent activity
     - `gh pr list` — open PRs
   - Don't go overboard — a quick pulse, not a full audit

   **Linear:**
   - If the project has a Linear workspace/project, check recent issues and status

   **Memory & daily logs:**
   - Search recent daily logs and weekly digests for mentions of the project
   - Check memory.md for any stored project context

3. **Synthesize a status snapshot.** Keep it concise and useful:
   - What's the current state? (active, paused, shipping, blocked, etc.)
   - What's been happening recently?
   - What are the open threads or next steps?
   - Any decisions pending or blockers?

## Output

When mid-conversation, deliver the status directly in your response. Format naturally — don't force a rigid template. The goal is to answer "how's this project doing?" in a way that's immediately useful.

If something is unclear or you're curious about context you can't find, ask. Justin often has context that isn't written down yet — asking surfaces it and creates an opportunity to capture it.

## Notes

- Not every project has every source. A hobby shader project won't have Linear issues. A work project might not have a vault note yet. Work with what's available.
- If you can't find the project at all, say so and ask Justin for pointers. This is also a good signal that the project routing table in memory.md needs updating.
- When you discover new project info (a repo URL, a status change, a new link), update memory.md with it. Don't wait for permission.
