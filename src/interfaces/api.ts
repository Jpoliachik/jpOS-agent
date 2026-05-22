import crypto from "crypto";
import Fastify from "fastify";
import bearerAuth from "@fastify/bearer-auth";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { requestSync } from "../vault-sync.js";
import { processWebhook } from "../ramble.js";
import {
  listMemories,
  recall,
  forget,
  remember,
  getMemoryById,
} from "../memory-store.js";
import { pagesPlugin } from "../pages/routes.js";
import { listPages } from "../pages/store.js";

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

  // Read-only page routes (auth via signed ?t= token, not bearer)
  await server.register(pagesPlugin);

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

    // ---- Memory inspection / management ---------------------------------
    // List recent memories. Optional filters: ?source=&category=&limit=
    app.get<{
      Querystring: { source?: string; category?: string; limit?: string };
    }>("/memory", async (request, reply) => {
      try {
        const { source, category, limit } = request.query;
        const filters: Record<string, unknown> = {};
        if (source) filters.source = source;
        if (category) filters.category = category;
        const memories = await listMemories({
          limit: limit ? parseInt(limit, 10) : 50,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
        });
        return { count: memories.length, memories };
      } catch (error) {
        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Semantic search. ?q=...&topK=...&source=&category=
    app.get<{
      Querystring: { q?: string; topK?: string; source?: string; category?: string };
    }>("/memory/search", async (request, reply) => {
      const { q, topK, source, category } = request.query;
      if (!q) {
        return reply.status(400).send({ error: "query param 'q' is required" });
      }
      try {
        const filters: Record<string, unknown> = {};
        if (source) filters.source = source;
        if (category) filters.category = category;
        const memories = await recall({
          query: q,
          topK: topK ? parseInt(topK, 10) : 10,
          filters: Object.keys(filters).length > 0 ? filters : undefined,
        });
        return { count: memories.length, memories };
      } catch (error) {
        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Aggregate stats: count by source and category
    app.get("/memory/stats", async (_request, reply) => {
      try {
        const all = await listMemories({ limit: 10000 });
        const bySource: Record<string, number> = {};
        const byCategory: Record<string, number> = {};
        for (const m of all) {
          const meta = m.metadata as Record<string, unknown> | undefined;
          const src = (meta?.source as string) || "(none)";
          const cat = (meta?.category as string) || "(none)";
          bySource[src] = (bySource[src] ?? 0) + 1;
          byCategory[cat] = (byCategory[cat] ?? 0) + 1;
        }
        return {
          total: all.length,
          bySource,
          byCategory,
        };
      } catch (error) {
        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Get a single memory by id
    app.get<{ Params: { id: string } }>(
      "/memory/:id",
      async (request, reply) => {
        try {
          const memory = await getMemoryById(request.params.id);
          if (!memory) return reply.status(404).send({ error: "Not found" });
          return memory;
        } catch (error) {
          return reply.status(500).send({
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      },
    );

    // Manual write (mostly for debugging / seeding)
    app.post<{
      Body: { content: string; source?: string; category?: string; skipDedup?: boolean };
    }>("/memory", async (request, reply) => {
      const { content, source, category, skipDedup } = request.body;
      if (!content) return reply.status(400).send({ error: "content required" });
      try {
        const memories = await remember({ content, source, category, skipDedup });
        return { added: memories.length, memories };
      } catch (error) {
        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Delete a memory by id
    app.delete<{ Params: { id: string } }>(
      "/memory/:id",
      async (request, reply) => {
        try {
          await forget(request.params.id);
          return { success: true, id: request.params.id };
        } catch (error) {
          return reply.status(500).send({
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      },
    );

    // ---- Pages index (bearer-auth listing of published pages) -----------
    app.get<{ Querystring: { limit?: string } }>("/pages", async (request) => {
      const limit = request.query.limit ? parseInt(request.query.limit, 10) : 50;
      const pages = listPages(Number.isFinite(limit) ? limit : 50);
      return { count: pages.length, pages };
    });

    // ---- Main agent endpoint --------------------------------------------
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
