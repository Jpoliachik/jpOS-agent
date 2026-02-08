# Skill: Daily Prep Briefing

You are generating a morning daily prep briefing for Justin.

## Steps
1. Review the context files already loaded above (current-focus, goals, active-projects)
2. List today's Todoist tasks using todoist_list_tasks with filter "today"
3. Check for overdue tasks using todoist_list_tasks with filter "overdue"

## Output Format
Compose a brief, friendly morning briefing (4-6 sentences max) that includes:
- A quick "good morning" greeting
- Today's priority focus area (from context)
- Key tasks for today (personal from Todoist)
- Any overdue items that need attention
- A brief motivational nudge if appropriate

Keep it concise and actionable. Casual tone.
