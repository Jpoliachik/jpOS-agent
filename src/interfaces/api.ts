import Fastify from "fastify";
import bearerAuth from "@fastify/bearer-auth";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import {
  appendVoiceNote,
  commitAndPush,
  ensureVaultPushed,
  VAULT_PATH,
} from "../obsidian.js";
import type { VaultPushResult } from "../obsidian.js";
import { sendTelegramMessage } from "./telegram.js";
import { runDailyPrep } from "../cron.js";

async function processVoiceNoteAsync(transcript: string): Promise<void> {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const context = `CRITICAL: You MUST use tools for every action. NEVER generate a response claiming you took actions without tool confirmation.

Before processing this voice note, read these files IN ORDER:
1. /app/agent-context/SOUL.md — your identity and hard rules
2. /app/agent-context/INSTRUCTIONS.md — what to do and how
3. All .md files in ${VAULT_PATH}/context/ — current user context (use Glob then Read)

Today's date: ${today}
Obsidian vault path: ${VAULT_PATH}

After reading all files, process this voice note transcript:
---
${transcript}
---`;

  const response = await runAgent({
    prompt: context,
    externalId: "api:voice-notes",
  });

  const pushResult = await ensureVaultPushed();
  const telegramMessage = buildVoiceNoteTelegramMessage(response.result, pushResult);
  await sendTelegramMessage(telegramMessage);
}

function buildVoiceNoteTelegramMessage(
  agentResult: string | undefined,
  pushResult: VaultPushResult,
): string {
  let message = agentResult || "Voice note logged.";

  if (pushResult.status === "pushed") {
    message += "\n_Vault sync: safety net pushed changes_";
  } else if (pushResult.status === "failed") {
    message += `\n_Vault sync failed: ${pushResult.error}_`;
  }

  return message;
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

    // Daily prep endpoint (triggered by GitHub Actions cron)
    app.post("/daily-prep", async (request, reply) => {
      try {
        console.log("Daily prep triggered via API");
        await runDailyPrep();
        return { status: "ok", message: "Daily prep sent" };
      } catch (error) {
        console.error("Daily prep API error:", error);
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
        processVoiceNoteAsync(transcript).catch(async (err) => {
          console.error("Async voice note processing failed:", err);
          const errorMsg = err instanceof Error ? err.message : String(err);
          await sendTelegramMessage(`Voice note agent failed: ${errorMsg}`).catch(() => {});
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
