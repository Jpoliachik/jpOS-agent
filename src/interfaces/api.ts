import Fastify from "fastify";
import bearerAuth from "@fastify/bearer-auth";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { pushVaultChanges } from "../obsidian.js";
import { processWebhook } from "../ramble.js";

export async function createApiServer() {
  const server = Fastify({ logger: true });

  // Health check (no auth required)
  server.get("/health", async () => {
    return { status: "ok" };
  });

  // Ramble webhook (uses X-Webhook-Secret, not bearer auth)
  server.post<{
    Body: {
      recording_id: string;
      created_at: string;
      duration: number;
      transcription: string;
      device_id: string;
    };
  }>("/ramble/webhook", async (request, reply) => {
    const secret = request.headers["x-webhook-secret"];
    if (!env.rambleWebhookSecret || secret !== env.rambleWebhookSecret) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { recording_id, transcription, created_at, duration } = request.body;

    if (!recording_id) {
      return reply.status(400).send({ error: "recording_id is required" });
    }

    // Fire async — webhook just needs a 200
    processWebhook({
      recordingId: recording_id,
      transcript: transcription ?? "",
      createdAt: created_at,
      duration: duration,
    }).catch((err) => {
      console.error("processWebhook unexpected error:", err);
    });

    return reply.status(200).send("OK");
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

        await pushVaultChanges();

        return {
          result: response.result,
          messages: response.messages,
          sessionId: response.sessionId,
        };
      } catch (error) {
        console.error("Agent error:", error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });
  });

  return server;
}
