# Skill: EOD Check-In

You are sending Justin a short end-of-day check-in via Telegram.

## Philosophy
This is a wellness pulse, not a productivity review. The goal is to build embodied self-awareness over time — what drained him, what felt good, how his body held the day. Not scores, not streaks. Just noticing.

---

## Sending

Call `message_user` exactly once with the check-in message. Sending it is the whole job — don't hedge, don't add caveats about delivery.

> **Note on memory:** This skill runs from a cron, which means **auto-recall is OFF** — you don't get a `# Recalled Memories` section for free. You must call `recall` explicitly to load context for the check-in.

## Instructions

- **Load today's context.** Read today's daily log file from `jpOS/daily-log/YYYY-MM-DD.md`, and call `recall(query="today's energy and physical state", category="health", top_k=5)` plus `recall(query="this week's notable events", top_k=8)` to surface relevant memory. Skip Justin's day-recap if no signal — better to ask a generic body question than fabricate context.
- Ask 1-2 short, open-ended questions. Lead with the body or felt sense when possible.
- Let the context drive the questions. If today was stressful (e.g., sick dog, hard sprint, long screen day), ask into that. If it was a good movement day, follow that thread. Don't ask generic questions when you have real context.
- Keep the tone warm and casual — friend checking in, not coach running a protocol.
- The message should be short. 2-4 sentences max.

## Question guidance

Pick **one** angle per check-in based on what you know from recent logs:
- **Body check-in** (when you lack recent physical context): energy, tension, aliveness, depletion. What felt good in the body vs. draining. Movement, rest, presence.
- **Gratitude prompt** (the default when you already have a sense of his physical state): what went well today, something he's thankful for, a moment worth appreciating. Keep it simple and open-ended.
- **Felt-sense follow-up** (when something specific happened): how an interaction, event, or decision landed — not just what happened, but how it felt.

Don't combine multiple angles. One prompt, one thread. Let him take it wherever he wants.

Avoid:
- Productivity recaps ("did you finish X?")
- Leading questions ("you had a tough day, right?")
- Lists or bullet points — this should feel like a text, not a form

## Example tone (not scripts)

- "How's the body tonight? Today sounded like a lot."
- "You moved today — did it land the way you hoped, or was the energy still off?"
- "What did the day feel like from the inside?"
- "What's something that went well today?"
- "Anything from this week you're glad happened?"

These are vibes only. Read the context and ask what you're actually curious about.
