import Fastify from "fastify";
import bearerAuth from "@fastify/bearer-auth";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { appendVoiceNote, withVaultSync } from "../obsidian.js";
import { sendTelegramMessage, sendTelegramTypingIndicator } from "./telegram.js";
import { buildSystemContext } from "../instructions.js";

async function processVoiceNoteAsync(transcript: string): Promise<void> {
  const result = await withVaultSync(async () => {
    const systemContext = buildSystemContext("voice-note", { transcript });
    const response = await runAgent({
      prompt: "Process the voice note transcript described in your instructions.",
      externalId: "api:voice-notes",
      systemContext,
    });
    return response.result;
  });

  await sendTelegramMessage(result || "Voice note processed.");
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
        const response = await withVaultSync(async () => {
          return runAgent({
            prompt,
            externalId,
            systemContext: context,
          });
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
            timeZone: "America/New_York",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
        : undefined;

      try {
        // Send typing indicator to Telegram while processing
        await sendTelegramTypingIndicator();

        // Save voice note to vault
        const { filePath, isDuplicate } = await withVaultSync(async () => {
          return appendVoiceNote({ transcript, timestamp, duration, id, createdAt });
        });

        if (isDuplicate) {
          return {
            result: "Duplicate voice note - already logged",
            logged: false,
            duplicate: true,
          };
        }

        console.log(`Voice note saved to ${filePath}`);

        // Process with agent async (don't block response)
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
