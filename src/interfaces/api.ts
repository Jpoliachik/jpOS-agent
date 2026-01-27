import Fastify from "fastify";
import bearerAuth from "@fastify/bearer-auth";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { appendVoiceNote, commitAndPush, readVaultGuide, readContextFiles, VAULT_PATH } from "../obsidian.js";
import { sendTelegramMessage } from "./telegram.js";

async function processVoiceNoteAsync(transcript: string): Promise<void> {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const vaultGuide = readVaultGuide();
  const vaultGuideSection = vaultGuide
    ? `\n## Vault Conventions\nThe Obsidian vault has a structured system. Follow these conventions when creating or organizing notes:\n\n${vaultGuide}\n`
    : "";

  const contextFiles = readContextFiles();
  const contextFilesSection = contextFiles
    ? `\n## Context Files\nThese files reflect Justin's current state — priorities, people, and goals. Use this awareness when processing voice notes.\n\n${contextFiles}\n`
    : "";

  const context = `You received a voice note transcription that has been logged to Obsidian.
Today's date is ${today}.
The Obsidian vault is at: ${VAULT_PATH}

Your job is to analyze this transcript and take proactive action. Do NOT ask for permission — just do it and report what you did.
${vaultGuideSection}${contextFilesSection}
## Todoist Tasks
If the transcript mentions tasks, to-dos, reminders, or things to follow up on:
- Create the task immediately using the todoist_create_task tool
- ALWAYS set a due_string. Use the date mentioned in the transcript. If no specific date is mentioned, use "today"
- The user relies on due dates in Todoist — tasks without dates get lost and never resurface
- Be confident: if it sounds like a task, create it
- ALWAYS end the description field with "Created by jpOS". If there's useful context that would help accomplish the task, add a brief note before that line. Otherwise just use "Created by jpOS" as the entire description.

## GitHub Issues
If the transcript contains feedback, bug reports, feature requests, or improvements for software projects:
- First, read the active projects file: ${VAULT_PATH}/context/active-projects.md
- Match the feedback to the appropriate project/repo listed in that file
- Create GitHub issues using bash:
  curl -s -X POST -H "Authorization: Bearer $GITHUB_PAT" -H "Content-Type: application/json" https://api.github.com/repos/OWNER/REPO/issues -d '{"title": "...", "body": "..."}'
  (Replace OWNER/REPO with the actual values from the active projects file)
- Write clear issue titles and well-formatted descriptions based on the voice note context
- If you can't match feedback to a known project, just mention it in your summary

## Active Projects Maintenance
You maintain the file: ${VAULT_PATH}/context/active-projects.md
This file tracks which projects the user is actively working on, with their GitHub repos.

Format:
\`\`\`
# Active Projects

## Project Name
- repo: owner/repo-name
- Short description
\`\`\`

- If the user mentions a project NOT already in the file, look up their GitHub repos:
  curl -s -H "Authorization: Bearer $GITHUB_PAT" "https://api.github.com/users/Jpoliachik/repos?per_page=100&sort=updated"
  Find the matching repo and add it to active-projects.md.
- If the user says they're done with a project or no longer working on it, remove it from the file.
- After modifying the file, commit and push:
  cd ${VAULT_PATH} && git add context/active-projects.md && git commit -m "Update active projects" && git push
- If the file doesn't exist yet, create it when you first need to add a project.

## Creating Notes
If the transcript contains ideas, insights, or concepts worth capturing as standalone notes:
- Create them in the vault following the vault conventions above
- Place notes in the appropriate folder (notes/ for ideas/concepts, logs/ for time-bound entries)
- Add frontmatter with created date and tags
- Search for related existing notes and add [[wikilinks]]
- After creating notes, commit and push:
  cd ${VAULT_PATH} && git add -A && git commit -m "Add note: <title>" && git push

## Context File Updates
If the voice note contains information relevant to these context files, update them:
- **context/current-focus.md** — Priority/focus changes, starting or completing something, shifting what's on deck.
- **context/people.md** — New people mentioned with context, relationship changes, new projects with someone.
- **context/goals.md** — Goal declarations, intentions expressed, goals completed, direction shifts.
After updating context files, commit and push:
cd ${VAULT_PATH} && git add -A && git commit -m "Update context files" && git push

## IMPORTANT: Verify your actions
- NEVER claim you completed an action unless you actually called the tool AND received a successful response
- If a tool call fails or you cannot execute it, say so explicitly (e.g. "Tried to create a Todoist task but it failed: <reason>")
- Only report actions as done if you have confirmation from the tool response

## Response
After taking all actions, respond with a concise Telegram summary (2-4 sentences max):
- List what actions you took (e.g. "Added Todoist task: X (due tomorrow)", "Filed issue #N on repo/name")
- If any action failed, say so clearly
- Briefly acknowledge any non-actionable content (reflections, journal entries)
- Friendly, casual tone`;

  const response = await runAgent({
    prompt: transcript,
    externalId: "api:voice-notes",
    systemContext: context,
  });

  const telegramMessage = response.result || "Voice note logged.";
  await sendTelegramMessage(telegramMessage);
}

export async function createApiServer() {
  const server = Fastify({ logger: true });

  // Health check (no auth required)
  server.get("/health", async () => {
    return { status: "ok" };
  });

  // Register authenticated routes in a separate scope
  await server.register(async (app) => {
    await app.register(bearerAuth, {
      keys: new Set([env.apiBearerToken]),
    });

    // Main agent endpoint
    app.post<{
      Body: {
        prompt: string;
        clientId?: string;
        context?: string;
      };
    }>("/agent", async (request, reply) => {
      const { prompt, clientId, context } = request.body;

      if (!prompt) {
        return reply.status(400).send({ error: "prompt is required" });
      }

      const externalId = `api:${clientId || "default"}`;

      try {
        const response = await runAgent({
          prompt,
          externalId,
          systemContext: context,
        });

        return {
          result: response.result,
          sessionId: response.sessionId,
        };
      } catch (error) {
        console.error("Agent error:", error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Voice note processing endpoint
    app.post<{
      Body: {
        id: string;
        createdAt: string;
        duration: number;
        transcript: string;
      };
    }>("/voice-note", async (request, reply) => {
      const { id, createdAt, duration, transcript } = request.body;

      if (!transcript) {
        return reply.status(400).send({ error: "transcript is required" });
      }

      // Format timestamp from createdAt
      const timestamp = createdAt
        ? new Date(createdAt).toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
        : undefined;

      try {
        // 1. Log to Obsidian vault
        const { filePath, isDuplicate } = await appendVoiceNote({ transcript, timestamp, duration, id, createdAt });

        if (isDuplicate) {
          return {
            result: "Duplicate voice note - already logged",
            logged: false,
            duplicate: true,
          };
        }

        const dateStr = new Date().toISOString().split("T")[0];
        await commitAndPush(`Voice note ${dateStr}`);
        console.log(`Voice note saved to ${filePath}`);

        // 2. Process with LLM async (don't block response)
        processVoiceNoteAsync(transcript).catch((err) => {
          console.error("Async voice note processing failed:", err);
        });

        return {
          logged: true,
        };
      } catch (error) {
        console.error("Voice note error:", error);

        // Still try to notify via Telegram about the error
        await sendTelegramMessage(`Voice note processing failed: ${error instanceof Error ? error.message : "Unknown error"}`);

        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });
  });

  return server;
}
