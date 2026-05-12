/**
 * Memory store — thin wrapper around mem0 (https://github.com/mem0ai/mem0)
 * configured with Qdrant for vectors, OpenAI for embeddings, and an OpenAI
 * mini-tier LLM for extraction/dedup.
 *
 * Single-user system: all memories are written under a fixed userId ("jp").
 * Use metadata.source ("voice-note", "telegram", "daily-prep", "manual", etc.)
 * to distinguish where a memory came from.
 */

import { Memory, type MemoryItem } from "mem0ai/oss";

/**
 * Read env vars directly (not via ./config.js) so this module is safe to import
 * from MCP subprocesses, which don't have the full jpOS env (no Telegram token, etc.).
 * The parent process passes OPENAI_API_KEY + QDRANT_URL via MCP server config.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const JPOS_USER_ID = "jp";
export const COLLECTION_NAME = "jpos_memories";

let memoryInstance: Memory | null = null;

function parseQdrantUrl(url: string): { host: string; port: number } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parsed.port ? parseInt(parsed.port, 10) : 6333,
  };
}

function getMemory(): Memory {
  if (memoryInstance) return memoryInstance;

  const openaiApiKey = requireEnv("OPENAI_API_KEY");
  const qdrantUrl = process.env.QDRANT_URL || "http://localhost:6333";
  const llmModel = process.env.MEM0_LLM_MODEL || "gpt-4.1-nano";
  const embeddingModel = process.env.MEM0_EMBEDDING_MODEL || "text-embedding-3-small";
  const historyDbPath = process.env.MEM0_HISTORY_DB_PATH || "./mem0-history.db";

  const { host, port } = parseQdrantUrl(qdrantUrl);
  console.log(
    `[mem0] init           | qdrant=${host}:${port} collection=${COLLECTION_NAME} ` +
      `llm=${llmModel} embed=${embeddingModel} historyDb=${historyDbPath}`,
  );

  memoryInstance = new Memory({
    embedder: {
      provider: "openai",
      config: { apiKey: openaiApiKey, model: embeddingModel },
    },
    vectorStore: {
      provider: "qdrant",
      config: { host, port, collectionName: COLLECTION_NAME },
    },
    llm: {
      provider: "openai",
      config: { apiKey: openaiApiKey, model: llmModel },
    },
    historyDbPath,
  });

  return memoryInstance;
}

export interface RememberParams {
  /** Raw text to remember. */
  content: string;
  /** Where this memory came from (voice-note, telegram, daily-prep, etc.). */
  source?: string;
  /** Optional category tag for filtering later. */
  category?: string;
  /** Free-form metadata merged with source/category. */
  metadata?: Record<string, unknown>;
  /**
   * Whether to use mem0's LLM-driven fact extraction (default true).
   * Set false to store `content` verbatim as a single memory.
   */
  infer?: boolean;
}

export async function remember(params: RememberParams): Promise<MemoryItem[]> {
  const { content, source, category, metadata, infer = true } = params;
  const memory = getMemory();

  const fullMetadata: Record<string, unknown> = {
    ...(metadata ?? {}),
    timestamp: new Date().toISOString(),
  };
  if (source) fullMetadata.source = source;
  if (category) fullMetadata.category = category;

  const start = Date.now();
  const preview = content.slice(0, 80).replace(/\s+/g, " ");
  console.log(
    `[mem0] remember start | source=${source ?? "-"} category=${category ?? "-"} infer=${infer} content="${preview}${content.length > 80 ? "…" : ""}"`,
  );

  try {
    const result = await memory.add(content, {
      userId: JPOS_USER_ID,
      metadata: fullMetadata,
      infer,
    });
    console.log(
      `[mem0] remember done  | ${result.results.length} memories in ${Date.now() - start}ms`,
    );
    return result.results;
  } catch (err) {
    console.error(
      `[mem0] remember FAIL  | ${Date.now() - start}ms |`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

export interface RecallParams {
  query: string;
  topK?: number;
  /** Optional metadata filters (e.g., { source: "voice-note" }). */
  filters?: Record<string, unknown>;
  /** Minimum similarity score (0-1). */
  threshold?: number;
}

export async function recall(params: RecallParams): Promise<MemoryItem[]> {
  const { query, topK = 5, filters, threshold } = params;
  const memory = getMemory();
  const start = Date.now();
  const preview = query.slice(0, 80).replace(/\s+/g, " ");
  console.log(
    `[mem0] recall start   | topK=${topK} filters=${filters ? JSON.stringify(filters) : "-"} query="${preview}${query.length > 80 ? "…" : ""}"`,
  );

  try {
    const result = await memory.search(query, {
      topK,
      filters: { user_id: JPOS_USER_ID, ...(filters ?? {}) },
      threshold,
    });
    const scores = result.results.map((r) => r.score?.toFixed(2)).join(",");
    console.log(
      `[mem0] recall done    | ${result.results.length} hits in ${Date.now() - start}ms | scores=[${scores}]`,
    );
    return result.results;
  } catch (err) {
    console.error(
      `[mem0] recall FAIL    | ${Date.now() - start}ms |`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

export interface ListMemoriesParams {
  limit?: number;
  filters?: Record<string, unknown>;
}

export async function listMemories(
  params: ListMemoriesParams = {},
): Promise<MemoryItem[]> {
  const { limit = 50, filters } = params;
  const memory = getMemory();
  const start = Date.now();
  console.log(
    `[mem0] list start     | limit=${limit} filters=${filters ? JSON.stringify(filters) : "-"}`,
  );

  try {
    const result = await memory.getAll({
      topK: limit,
      filters: { user_id: JPOS_USER_ID, ...(filters ?? {}) },
    });
    console.log(
      `[mem0] list done      | ${result.results.length} memories in ${Date.now() - start}ms`,
    );
    return result.results;
  } catch (err) {
    console.error(
      `[mem0] list FAIL      | ${Date.now() - start}ms |`,
      err instanceof Error ? err.message : err,
    );
    throw err;
  }
}

export async function forget(memoryId: string): Promise<void> {
  const memory = getMemory();
  console.log(`[mem0] forget         | id=${memoryId}`);
  await memory.delete(memoryId);
}

export async function updateMemory(
  memoryId: string,
  newContent: string,
): Promise<void> {
  const memory = getMemory();
  console.log(`[mem0] update         | id=${memoryId}`);
  await memory.update(memoryId, newContent);
}

export async function getMemoryById(
  memoryId: string,
): Promise<MemoryItem | null> {
  const memory = getMemory();
  return memory.get(memoryId);
}
