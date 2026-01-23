import Fastify from "fastify";
import bearerAuth from "@fastify/bearer-auth";
import { env } from "../config.js";
import { runAgent } from "../agent.js";

export async function createApiServer() {
  const server = Fastify({ logger: true });

  // Bearer token auth
  await server.register(bearerAuth, {
    keys: new Set([env.apiBearerToken]),
  });

  // Health check (no auth required)
  server.get("/health", { config: { rawBody: true } }, async () => {
    return { status: "ok" };
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

    const context = `You are processing a voice journal entry from ${timestamp || "now"}.
Analyze this transcript and:
1. Identify any actionable items or tasks mentioned
2. Create Todoist tasks for any action items
3. Summarize key insights or reflections
4. Note any follow-ups needed

Be concise in your response.`;

    try {
      const response = await runAgent({
        prompt: transcript,
        externalId: "api:voice-notes",
        systemContext: context,
      });

      return {
        result: response.result,
        sessionId: response.sessionId,
      };
    } catch (error) {
      console.error("Voice note error:", error);
      return reply.status(500).send({
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  return server;
}
