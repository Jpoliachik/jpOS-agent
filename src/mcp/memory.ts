#!/usr/bin/env node
/**
 * Memory MCP Server
 *
 * Exposes the mem0-backed memory store to the agent as tool calls:
 *   - remember:      store something to long-term memory
 *   - recall:        semantic search over past memories
 *   - list_memories: list recent / filtered memories
 *   - forget:        delete a memory by id
 *   - update_memory: rewrite a memory's content
 *
 * Env: OPENAI_API_KEY (required), QDRANT_URL, MEM0_LLM_MODEL,
 * MEM0_EMBEDDING_MODEL, MEM0_HISTORY_DB_PATH.
 */

import {
  remember,
  recall,
  listMemories,
  forget,
  updateMemory,
} from "../memory-store.js";

const tools = [
  {
    name: "remember",
    description:
      "Store something to long-term memory. Use when the user shares a preference, " +
      "fact about themselves, a decision, a commitment, or anything you should know " +
      "in future conversations. mem0 will extract atomic facts from the content unless " +
      "infer=false (in which case the content is stored verbatim as a single memory).",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The raw text or observation to remember.",
        },
        source: {
          type: "string",
          description:
            "Where this memory came from (e.g., 'voice-note', 'telegram', 'daily-prep'). " +
            "Used for filtering during recall.",
        },
        category: {
          type: "string",
          description:
            "Optional category tag (e.g., 'preference', 'project', 'person'). " +
            "Used for filtering during recall.",
        },
        infer: {
          type: "boolean",
          description:
            "If true (default), mem0's LLM extracts atomic facts from content and " +
            "decides whether to add/update/delete existing memories. " +
            "If false, content is stored verbatim as a single memory.",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "recall",
    description:
      "Semantic search over long-term memory. Use proactively when the user " +
      "references something past, asks about themselves, or when you need context " +
      "to answer well. Returns memories ranked by relevance.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language query to search memories for.",
        },
        top_k: {
          type: "number",
          description: "Max number of memories to return (default 5).",
        },
        source: {
          type: "string",
          description: "Optional filter: only return memories from this source.",
        },
        category: {
          type: "string",
          description: "Optional filter: only return memories with this category.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_memories",
    description:
      "List recent memories without a semantic query. Useful for browsing or " +
      "filtering by source/category.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max memories to return (default 50)." },
        source: { type: "string", description: "Filter by source." },
        category: { type: "string", description: "Filter by category." },
      },
    },
  },
  {
    name: "forget",
    description:
      "Delete a memory by its ID. Use when the user asks to forget something or " +
      "when a memory is clearly wrong or outdated. The ID comes from recall/list_memories.",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "ID of the memory to delete." },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "update_memory",
    description:
      "Rewrite the content of an existing memory by ID. Use when a fact changes " +
      "and you want to overwrite rather than add a contradicting memory.",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "string", description: "ID of the memory to update." },
        content: { type: "string", description: "New content for the memory." },
      },
      required: ["memory_id", "content"],
    },
  },
];

interface ToolArgs {
  content?: string;
  source?: string;
  category?: string;
  infer?: boolean;
  query?: string;
  top_k?: number;
  limit?: number;
  memory_id?: string;
}

async function handleToolCall(name: string, args: ToolArgs): Promise<unknown> {
  switch (name) {
    case "remember": {
      if (!args.content) throw new Error("remember requires 'content'");
      const items = await remember({
        content: args.content,
        source: args.source,
        category: args.category,
        infer: args.infer,
      });
      return { added: items.length, memories: items };
    }

    case "recall": {
      if (!args.query) throw new Error("recall requires 'query'");
      const filters: Record<string, unknown> = {};
      if (args.source) filters.source = args.source;
      if (args.category) filters.category = args.category;
      const items = await recall({
        query: args.query,
        topK: args.top_k,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });
      return { count: items.length, memories: items };
    }

    case "list_memories": {
      const filters: Record<string, unknown> = {};
      if (args.source) filters.source = args.source;
      if (args.category) filters.category = args.category;
      const items = await listMemories({
        limit: args.limit,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });
      return { count: items.length, memories: items };
    }

    case "forget": {
      if (!args.memory_id) throw new Error("forget requires 'memory_id'");
      await forget(args.memory_id);
      return { success: true, memory_id: args.memory_id };
    }

    case "update_memory": {
      if (!args.memory_id || !args.content) {
        throw new Error("update_memory requires 'memory_id' and 'content'");
      }
      await updateMemory(args.memory_id, args.content);
      return { success: true, memory_id: args.memory_id };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function main() {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    let requestId: unknown = null;
    try {
      const request = JSON.parse(line);
      requestId = request.id;
      let response: unknown;

      switch (request.method) {
        case "initialize":
          response = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "memory-mcp", version: "1.0.0" },
          };
          break;

        case "tools/list":
          response = { tools };
          break;

        case "tools/call": {
          const result = await handleToolCall(
            request.params.name,
            request.params.arguments || {},
          );
          response = {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
          break;
        }

        default:
          response = { error: { code: -32601, message: "Method not found" } };
      }

      console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: response }));
    } catch (error) {
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: requestId,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : "Unknown error",
          },
        }),
      );
    }
  }
}

main().catch(console.error);
