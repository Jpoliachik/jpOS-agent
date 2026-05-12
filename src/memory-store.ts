/**
 * Memory store — thin wrapper over Qdrant + OpenAI embeddings.
 *
 * Single-user system: all memories are written under a fixed userId ("jp").
 * Use metadata.source ("voice-note", "telegram", "daily-prep", etc.) to
 * distinguish where a memory came from.
 *
 * Behavior:
 *  - remember(content):  embed → optionally dedupe against existing nearest
 *                        neighbor (one LLM call to decide ADD/REPLACE/NOOP)
 *                        → upsert to Qdrant.
 *  - recall(query):       embed → vector search.
 *  - listMemories():      scroll the collection with optional filters.
 *  - forget/update/get:   trivial direct Qdrant ops.
 *
 * No memory extraction — we trust the caller (the agent) to pass clean
 * atomic facts. The agent's system prompt instructs it accordingly.
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

export const JPOS_USER_ID = "jp";
export const COLLECTION_NAME = "jpos_memories";

/** Vector dimension for OpenAI text-embedding-3-small. */
const EMBED_DIMS = 1536;

/**
 * Cosine similarity threshold above which we treat a hit as a possible
 * duplicate worth asking the LLM to reconcile. Below this we just ADD.
 */
const DEDUP_THRESHOLD = 0.85;

export interface MemoryItem {
  id: string;
  memory: string;
  metadata?: Record<string, unknown>;
  score?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface RememberParams {
  /** Atomic fact, already formatted (e.g. "User prefers dark mode"). */
  content: string;
  /** Where this memory came from. Required by convention. */
  source?: string;
  /** Free-form tag (e.g. "preference", "project", "person"). */
  category?: string;
  /** Extra metadata merged into the payload alongside source/category. */
  metadata?: Record<string, unknown>;
  /**
   * Skip the dedup LLM call and just ADD a new point. Useful for batch
   * imports / migration where we know there's no conflict.
   */
  skipDedup?: boolean;
}

export interface RecallParams {
  query: string;
  topK?: number;
  /** Metadata filters merged with the user_id filter (e.g. { source: "voice-note" }). */
  filters?: Record<string, unknown>;
  /** Minimum similarity score (0..1). */
  threshold?: number;
}

export interface ListMemoriesParams {
  limit?: number;
  filters?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Lazy singletons + env
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let qdrantClient: QdrantClient | null = null;
let openaiClient: OpenAI | null = null;
let collectionReady = false;

function getQdrant(): QdrantClient {
  if (qdrantClient) return qdrantClient;
  const url = process.env.QDRANT_URL || "http://localhost:6333";
  console.log(`[mem] init qdrant    | url=${url} collection=${COLLECTION_NAME}`);
  qdrantClient = new QdrantClient({ url });
  return qdrantClient;
}

function getOpenAI(): OpenAI {
  if (openaiClient) return openaiClient;
  openaiClient = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return openaiClient;
}

/**
 * Create the Qdrant collection if it doesn't exist, and ensure the metadata
 * fields we filter on have payload indexes. Runs once per process.
 */
async function ensureCollection(): Promise<void> {
  if (collectionReady) return;
  const client = getQdrant();
  try {
    await client.getCollection(COLLECTION_NAME);
  } catch {
    console.log(`[mem] create coll    | name=${COLLECTION_NAME} dims=${EMBED_DIMS} distance=Cosine`);
    await client.createCollection(COLLECTION_NAME, {
      vectors: { size: EMBED_DIMS, distance: "Cosine" },
    });
    // Indexes for the fields we filter on. createPayloadIndex is idempotent —
    // safe if called more than once.
    for (const field of ["userId", "source", "category"]) {
      try {
        await client.createPayloadIndex(COLLECTION_NAME, {
          field_name: field,
          field_schema: "keyword",
        });
      } catch (err) {
        console.warn(`[mem] index ${field} already exists or failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
  collectionReady = true;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function embed(text: string): Promise<number[]> {
  const model = process.env.MEMORY_EMBEDDING_MODEL || "text-embedding-3-small";
  const result = await getOpenAI().embeddings.create({ model, input: text });
  return result.data[0].embedding;
}

interface QdrantPoint {
  id: string | number;
  payload?: Record<string, unknown> | null;
  score?: number;
}

function pointToMemory(point: QdrantPoint): MemoryItem {
  const payload = (point.payload ?? {}) as Record<string, unknown>;
  const { memory, userId, createdAt, updatedAt, ...rest } = payload;
  return {
    id: String(point.id),
    memory: typeof memory === "string" ? memory : "",
    metadata: rest,
    score: point.score,
    createdAt: typeof createdAt === "string" ? createdAt : undefined,
    updatedAt: typeof updatedAt === "string" ? updatedAt : undefined,
  };
}

interface QdrantFilter {
  must: Array<{ key: string; match: { value: string | number | boolean } }>;
}

function buildFilter(filters?: Record<string, unknown>): QdrantFilter {
  const must: QdrantFilter["must"] = [
    { key: "userId", match: { value: JPOS_USER_ID } },
  ];
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (k === "user_id" || k === "userId") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        must.push({ key: k, match: { value: v } });
      }
    }
  }
  return { must };
}

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

type DedupAction =
  | { action: "ADD" }
  | { action: "REPLACE"; id: string }
  | { action: "NOOP"; id: string };

async function decideDedup(content: string, candidates: QdrantPoint[]): Promise<DedupAction> {
  if (candidates.length === 0) return { action: "ADD" };

  const candidateList = candidates
    .map((c, i) => {
      const mem = (c.payload as Record<string, unknown> | undefined)?.memory ?? "";
      return `${i + 1}. id=${c.id} score=${c.score?.toFixed(2)}: ${mem}`;
    })
    .join("\n");

  const prompt = `You're deduplicating memories for a personal AI agent.

NEW FACT: "${content}"

SIMILAR EXISTING MEMORIES (already stored, ranked by similarity):
${candidateList}

Decide what to do with the new fact. Respond with JSON only:
- {"action": "ADD"} — the new fact is genuinely distinct from all existing memories. Default to this unless one of them is clearly the same fact.
- {"action": "REPLACE", "id": "<existing-id>"} — the new fact is a clearer or updated version of an existing memory; overwrite that one.
- {"action": "NOOP", "id": "<existing-id>"} — the new fact is already fully captured by an existing memory; skip storing.

Bias toward ADD when in doubt. Only REPLACE if the new fact is meaningfully better. Only NOOP if it's a near-exact duplicate.`;

  const model = process.env.MEMORY_DEDUP_MODEL || "gpt-4.1-nano";
  const result = await getOpenAI().chat.completions.create({
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const raw = result.choices[0]?.message?.content || "{}";
  let parsed: { action?: string; id?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn(`[mem] dedup parse failed, defaulting to ADD. raw="${raw.slice(0, 200)}"`);
    return { action: "ADD" };
  }

  if (parsed.action === "REPLACE" && parsed.id && candidates.some((c) => String(c.id) === parsed.id)) {
    return { action: "REPLACE", id: parsed.id };
  }
  if (parsed.action === "NOOP" && parsed.id && candidates.some((c) => String(c.id) === parsed.id)) {
    return { action: "NOOP", id: parsed.id };
  }
  return { action: "ADD" };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function remember(params: RememberParams): Promise<MemoryItem[]> {
  await ensureCollection();
  const { content, source, category, metadata, skipDedup = false } = params;
  const start = Date.now();
  const preview = content.slice(0, 80).replace(/\s+/g, " ");
  console.log(
    `[mem] remember start | source=${source ?? "-"} category=${category ?? "-"} content="${preview}${content.length > 80 ? "…" : ""}"`,
  );

  try {
    const vector = await embed(content);
    const client = getQdrant();

    // Dedup pass (skip if explicitly requested or no useful neighbors).
    if (!skipDedup) {
      const neighbors = await client.search(COLLECTION_NAME, {
        vector,
        limit: 3,
        score_threshold: DEDUP_THRESHOLD,
        filter: buildFilter(),
        with_payload: true,
      });

      if (neighbors.length > 0) {
        const decision = await decideDedup(content, neighbors);

        if (decision.action === "NOOP") {
          const target = neighbors.find((n) => String(n.id) === decision.id);
          console.log(`[mem] remember done  | NOOP id=${decision.id.slice(0, 8)} in ${Date.now() - start}ms`);
          return target ? [pointToMemory(target)] : [];
        }

        if (decision.action === "REPLACE") {
          const target = neighbors.find((n) => String(n.id) === decision.id);
          const oldPayload = (target?.payload ?? {}) as Record<string, unknown>;
          const now = new Date().toISOString();
          const newPayload: Record<string, unknown> = {
            ...oldPayload,
            memory: content,
            updatedAt: now,
          };
          // If caller provided fresh metadata fields, prefer them.
          if (source) newPayload.source = source;
          if (category) newPayload.category = category;
          if (metadata) Object.assign(newPayload, metadata);

          await client.upsert(COLLECTION_NAME, {
            points: [{ id: decision.id, vector, payload: newPayload }],
          });
          console.log(`[mem] remember done  | REPLACE id=${decision.id.slice(0, 8)} in ${Date.now() - start}ms`);
          return [pointToMemory({ id: decision.id, payload: newPayload })];
        }
        // decision.action === "ADD" → fall through
      }
    }

    // ADD path
    const id = randomUUID();
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      memory: content,
      userId: JPOS_USER_ID,
      createdAt: now,
      ...(metadata ?? {}),
    };
    if (source) payload.source = source;
    if (category) payload.category = category;

    await client.upsert(COLLECTION_NAME, { points: [{ id, vector, payload }] });
    console.log(`[mem] remember done  | ADD id=${id.slice(0, 8)} in ${Date.now() - start}ms`);
    return [pointToMemory({ id, payload })];
  } catch (err) {
    console.error(
      `[mem] remember FAIL  | ${Date.now() - start}ms |`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

export async function recall(params: RecallParams): Promise<MemoryItem[]> {
  await ensureCollection();
  const { query, topK = 5, filters, threshold } = params;
  const start = Date.now();
  const preview = query.slice(0, 80).replace(/\s+/g, " ");
  console.log(
    `[mem] recall start   | topK=${topK} filters=${filters ? JSON.stringify(filters) : "-"} query="${preview}${query.length > 80 ? "…" : ""}"`,
  );

  try {
    const vector = await embed(query);
    const hits = await getQdrant().search(COLLECTION_NAME, {
      vector,
      limit: topK,
      score_threshold: threshold,
      filter: buildFilter(filters),
      with_payload: true,
    });
    const scores = hits.map((h) => h.score?.toFixed(2)).join(",");
    console.log(
      `[mem] recall done    | ${hits.length} hits in ${Date.now() - start}ms | scores=[${scores}]`,
    );
    return hits.map(pointToMemory);
  } catch (err) {
    console.error(
      `[mem] recall FAIL    | ${Date.now() - start}ms |`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

export async function listMemories(params: ListMemoriesParams = {}): Promise<MemoryItem[]> {
  await ensureCollection();
  const { limit = 50, filters } = params;
  const start = Date.now();
  console.log(
    `[mem] list start     | limit=${limit} filters=${filters ? JSON.stringify(filters) : "-"}`,
  );

  try {
    const result = await getQdrant().scroll(COLLECTION_NAME, {
      limit,
      filter: buildFilter(filters),
      with_payload: true,
      with_vector: false,
    });
    console.log(
      `[mem] list done      | ${result.points.length} memories in ${Date.now() - start}ms`,
    );
    return result.points.map(pointToMemory);
  } catch (err) {
    console.error(
      `[mem] list FAIL      | ${Date.now() - start}ms |`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

export async function forget(memoryId: string): Promise<void> {
  await ensureCollection();
  console.log(`[mem] forget         | id=${memoryId.slice(0, 8)}`);
  await getQdrant().delete(COLLECTION_NAME, { points: [memoryId] });
}

export async function updateMemory(memoryId: string, newContent: string): Promise<void> {
  await ensureCollection();
  console.log(`[mem] update         | id=${memoryId.slice(0, 8)}`);
  const client = getQdrant();
  const existing = await client.retrieve(COLLECTION_NAME, {
    ids: [memoryId],
    with_payload: true,
    with_vector: false,
  });
  if (existing.length === 0) {
    throw new Error(`Memory ${memoryId} not found`);
  }
  const oldPayload = (existing[0].payload ?? {}) as Record<string, unknown>;
  const vector = await embed(newContent);
  const now = new Date().toISOString();
  await client.upsert(COLLECTION_NAME, {
    points: [
      {
        id: memoryId,
        vector,
        payload: { ...oldPayload, memory: newContent, updatedAt: now },
      },
    ],
  });
}

export async function getMemoryById(memoryId: string): Promise<MemoryItem | null> {
  await ensureCollection();
  const result = await getQdrant().retrieve(COLLECTION_NAME, {
    ids: [memoryId],
    with_payload: true,
    with_vector: false,
  });
  if (result.length === 0) return null;
  return pointToMemory(result[0]);
}
