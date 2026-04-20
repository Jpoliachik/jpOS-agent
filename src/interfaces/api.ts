import crypto from "crypto";
import Fastify from "fastify";
import bearerAuth from "@fastify/bearer-auth";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { requestSync } from "../vault-sync.js";
import { processWebhook } from "../ramble.js";

function verifyWebhookSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function createApiServer() {
  const server = Fastify({ logger: true });

  // Capture raw body for HMAC signature verification
  server.decorateRequest("rawBody", undefined);
  server.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (req, body, done) => {
      (req as any).rawBody = body;
      try {
        done(null, JSON.parse(body.toString()));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Health check (no auth required)
  server.get("/health", async () => {
    return { status: "ok" };
  });

  // Ramble webhook (verified via HMAC-SHA256 signature)
  server.post<{
    Body: {
      recording_id: string;
      created_at: string;
      duration: number;
      transcription: string;
      device_id: string;
    };
  }>("/ramble/webhook", async (request, reply) => {
    const signature = request.headers["x-webhook-signature"] as string | undefined;
    const rawBody = (request as any).rawBody as Buffer | undefined;
    if (!env.rambleWebhookSecret || !signature || !rawBody ||
        !verifyWebhookSignature(rawBody, signature, env.rambleWebhookSecret)) {
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

        requestSync();

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
