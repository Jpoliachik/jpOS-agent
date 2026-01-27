import Fastify from "fastify";
import bearerAuth from "@fastify/bearer-auth";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { appendVoiceNote, commitAndPush } from "../obsidian.js";
import { sendTelegramMessage } from "./telegram.js";

export async function createApiServer() {
  const server = Fastify({ logger: true });

  // Health check (no auth required)
  server.get("/health", async () => {
    return { status: "ok" };
  });

  // Bearer token auth for all other routes
  await server.register(bearerAuth, {
    keys: new Set([env.apiBearerToken]),
    addHook: false,
  });

  // Apply auth to all routes except health
  server.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    await (server as any).verifyBearerAuth(request, reply);
  });

  // Main agent endpoint
  server.post<{
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
  server.post<{
    Body: {
      transcript: string;
      timestamp?: string;
    };
  }>("/voice-note", async (request, reply) => {
    const { transcript, timestamp } = request.body;

    if (!transcript) {
      return reply.status(400).send({ error: "transcript is required" });
    }

    try {
      // 1. Log to Obsidian vault
      const filePath = await appendVoiceNote({ transcript, timestamp });
      const dateStr = new Date().toISOString().split("T")[0];
      await commitAndPush(`Voice note ${dateStr}`);
      console.log(`Voice note saved to ${filePath}`);

      // 2. Run agent to analyze and suggest actions
      const context = `You received a voice note transcription that has been logged to Obsidian.

Analyze this transcript and respond with a brief summary for Telegram:
- If there are actionable items (todos, tasks, reminders), list them and ask if I want to add them to Todoist
- If there are ideas for GitHub issues or projects, mention them
- If it's just a reflection or journal entry with no actions, give a brief acknowledgment

Keep the response concise (2-4 sentences max). Use a friendly, casual tone.`;

      const response = await runAgent({
        prompt: transcript,
        externalId: "api:voice-notes",
        systemContext: context,
      });

      // 3. Send Telegram notification
      const telegramMessage = response.result || "Voice note logged.";
      await sendTelegramMessage(telegramMessage);

      return {
        result: response.result,
        sessionId: response.sessionId,
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

  return server;
}
