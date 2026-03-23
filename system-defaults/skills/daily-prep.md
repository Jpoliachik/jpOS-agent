# Skill: Daily Prep Briefing

You are generating a morning daily prep briefing for Justin.

## Steps
1. Review the reference context and recent memory loaded above — this tells you what's been happening lately
2. Check today's calendar agenda:
   ```
   gws calendar +agenda --today --timezone America/New_York
   ```
3. List today's Todoist tasks using todoist_list_tasks with filter "today"
4. Check for overdue tasks using todoist_list_tasks with filter "overdue"

## Output Format
**IMPORTANT: Your final text response IS the briefing itself — do NOT follow the general "Response Format" instructions for this skill. Do NOT summarize actions taken. Output the briefing directly as your last message.**

Write memory FIRST, then compose and output the briefing as your final response.

Compose a brief, friendly morning briefing (4-6 sentences max) that includes:
- A quick "good morning" greeting
- Today's calendar events and meetings (times and what they are)
- Today's priority focus area (from recent memory and context)
- Key tasks for today (personal from Todoist)
- Any overdue items that need attention
- A brief motivational nudge if appropriate

Keep it concise and actionable. Casual tone. This text will be sent directly to Telegram.
