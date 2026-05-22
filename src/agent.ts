import { query } from "@anthropic-ai/claude-agent-sdk";
import { getSession, setSession } from "./sessions.js";
import { env } from "./config.js";
import { recall } from "./memory-store.js";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface AgentResponse {
  result: string;
  /** Explicit messages sent via the send_message tool. Empty if agent used text output instead. */
  messages: string[];
  sessionId: string;
}

interface RunAgentParams {
  prompt: string;
  externalId: string;
  systemContext?: string;
  /**
   * Whether to auto-recall relevant memories based on `prompt` and inject
   * them into the system prompt. Defaults to true. Set false for cron jobs
   * where the prompt is an instruction, not a query.
   */
  autoRecall?: boolean;
  /** Max memories to surface in auto-recall. Defaults to 5. */
  autoRecallTopK?: number;
  /** Called with accumulated text as streaming deltas arrive */
  onTextDelta?: (accumulatedText: string) => void;
  /** Called immediately when the agent sends a message via the message_user tool */
  onMessage?: (text: string) => void;
}

/**
 * Search the memory store for memories relevant to `prompt` and format them
 * as a system-prompt section. Returns empty string if the store is unreachable
 * or returns no hits — the agent should still respond, just without recalled
 * context.
 */
async function autoRecallSection(prompt: string, topK: number): Promise<string> {
  try {
    const memories = await recall({ query: prompt, topK });
    if (memories.length === 0) return "";

    const lines = memories.map((m) => {
      const meta = m.metadata as Record<string, unknown> | undefined;
      const source = meta?.source ? ` (${meta.source})` : "";
      const score = m.score != null ? ` [score=${m.score.toFixed(2)}]` : "";
      return `- ${m.memory}${source}${score}`;
    });

    return [
      "# Recalled Memories",
      "",
      `*The following ${memories.length} memories surfaced as most relevant to the user's message. Use them as context but verify if anything seems stale.*`,
      "",
      ...lines,
      "",
    ].join("\n");
  } catch (err) {
    console.error(
      "[agent] auto-recall failed (continuing without recalled context):",
      err instanceof Error ? err.message : err,
    );
    return "";
  }
}

export async function runAgent(params: RunAgentParams): Promise<AgentResponse> {
  const {
    prompt,
    externalId,
    systemContext,
    autoRecall = true,
    autoRecallTopK = 5,
    onTextDelta,
    onMessage,
  } = params;

  const existingSession = getSession(externalId);
  let sessionId: string | undefined = existingSession?.agentSessionId;
  let result = "";

  // Auto-recall: surface relevant memories and append to systemContext.
  // Fail-graceful — if Qdrant is down, agent still runs without recalled context.
  let finalSystemContext = systemContext;
  if (autoRecall && prompt && prompt.trim().length > 0) {
    const recallSection = await autoRecallSection(prompt, autoRecallTopK);
    if (recallSection) {
      finalSystemContext = finalSystemContext
        ? `${finalSystemContext}\n\n${recallSection}`
        : recallSection;
    }
  }

  // Temp file for collecting message_user calls (only needed when no onMessage callback)
  const messageFile = onMessage
    ? null
    : join(tmpdir(), `jpos-messages-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  if (messageFile) writeFileSync(messageFile, "[]");

  // Build MCP servers config
  const mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {
    "send-message": {
      command: "node",
      args: [process.env.MCP_SEND_MESSAGE_PATH || "/app/dist/mcp/send-message.js"],
      env: {
        JPOS_MESSAGE_FILE: messageFile || "/dev/null",
      },
    },
    todoist: {
      command: "node",
      args: [process.env.MCP_TODOIST_PATH || "/app/dist/mcp/todoist.js"],
      env: {
        TODOIST_API_TOKEN: env.todoistApiToken,
      },
    },
    memory: {
      command: "node",
      args: [process.env.MCP_MEMORY_PATH || "/app/dist/mcp/memory.js"],
      env: {
        OPENAI_API_KEY: env.openaiApiKey,
        QDRANT_URL: env.qdrantUrl,
        MEMORY_EMBEDDING_MODEL: env.memoryEmbeddingModel,
        MEMORY_DEDUP_MODEL: env.memoryDedupModel,
      },
    },
  };

  // Build allowed tools list
  const allowedTools = [
    "Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Skill",
    "mcp__send-message__message_user",
    "mcp__todoist__todoist_create_task",
    "mcp__todoist__todoist_list_tasks",
    "mcp__todoist__todoist_complete_task",
    "mcp__todoist__todoist_list_projects",
    "mcp__memory__remember",
    "mcp__memory__recall",
    "mcp__memory__list_memories",
    "mcp__memory__forget",
    "mcp__memory__update_memory",
  ];

  // Conditionally add App Store Connect MCP server
  if (env.appStoreConnectKeyId && env.appStoreConnectIssuerId && env.appStoreConnectP8Key) {
    mcpServers.appstoreconnect = {
      command: "node",
      args: [process.env.MCP_APPSTORECONNECT_PATH || "/app/dist/mcp/appstoreconnect.js"],
      env: {
        APP_STORE_CONNECT_KEY_ID: env.appStoreConnectKeyId,
        APP_STORE_CONNECT_ISSUER_ID: env.appStoreConnectIssuerId,
        APP_STORE_CONNECT_P8_KEY: env.appStoreConnectP8Key,
        APP_STORE_CONNECT_VENDOR_NUMBER: env.appStoreConnectVendorNumber,
      },
    };
    allowedTools.push(
      "mcp__appstoreconnect__appstore_list_apps",
      "mcp__appstoreconnect__appstore_get_app",
      "mcp__appstoreconnect__appstore_sales_report",
      "mcp__appstoreconnect__appstore_analytics_request",
      "mcp__appstoreconnect__appstore_analytics_reports",
      "mcp__appstoreconnect__appstore_analytics_instances",
      "mcp__appstoreconnect__appstore_analytics_download",
    );
  }

  // Conditionally add Google Calendar MCP server
  if (env.googleClientId && env.googleClientSecret && env.googleRefreshToken) {
    mcpServers.google = {
      command: "node",
      args: [process.env.MCP_GOOGLE_PATH || "/app/dist/mcp/google.js"],
      env: {
        GOOGLE_CLIENT_ID: env.googleClientId,
        GOOGLE_CLIENT_SECRET: env.googleClientSecret,
        GOOGLE_REFRESH_TOKEN: env.googleRefreshToken,
      },
    };
    allowedTools.push(
      "mcp__google__gcal_list_calendars",
      "mcp__google__gcal_agenda",
      "mcp__google__gcal_create_event",
    );
  }

  // Add Pages MCP server (only when signing secret is configured)
  if (env.pageSigningSecret) {
    mcpServers.pages = {
      command: "node",
      args: [process.env.MCP_PAGES_PATH || "/app/dist/mcp/pages.js"],
      env: {
        PAGE_SIGNING_SECRET: env.pageSigningSecret,
        PUBLIC_BASE_URL: env.publicBaseUrl,
        ...(process.env.PAGES_DIR ? { PAGES_DIR: process.env.PAGES_DIR } : {}),
      },
    };
    allowedTools.push(
      "mcp__pages__publish_page",
      "mcp__pages__mint_page_link",
      "mcp__pages__list_pages",
    );
  }

  // Add Linear MCP server
  mcpServers.linear = {
    command: "node",
    args: [process.env.MCP_LINEAR_PATH || "/app/dist/mcp/linear.js"],
    env: {
      LINEAR_API_KEYS: env.linearApiKeys,
    },
  };
  allowedTools.push(
    "mcp__linear__linear_list_teams",
    "mcp__linear__linear_search_issues",
    "mcp__linear__linear_get_issue",
    "mcp__linear__linear_create_issue",
    "mcp__linear__linear_update_issue",
    "mcp__linear__linear_add_comment",
    "mcp__linear__linear_list_projects",
  );

  // Track streaming text for the current assistant turn (reset on each new turn)
  let streamingText = "";
  let isStreamingTextBlock = false;
  // Track the last non-empty assistant text across all turns, used as fallback
  // when the SDK result is empty (e.g., agent ended on a tool call)
  let lastAssistantText = "";

  for await (const message of query({
    prompt,
    options: {
      model: "claude-sonnet-4-6",
      allowedTools,
      permissionMode: "acceptEdits",
      settingSources: ["project"],
      cwd: process.env.AGENT_CWD || "/app",
      mcpServers,
      includePartialMessages: !!onTextDelta,
      // System prompt is ephemeral (not stored in conversation history),
      // so it must be passed on every call including resumes.
      ...(finalSystemContext
        ? { systemPrompt: { type: "preset" as const, preset: "claude_code" as const, append: finalSystemContext } }
        : {}),
      ...(sessionId ? { resume: sessionId } : {}),
    },
  })) {
    // Capture session ID from init message
    if (
      message.type === "system" &&
      "subtype" in message &&
      message.subtype === "init" &&
      "session_id" in message
    ) {
      sessionId = message.session_id as string;
      setSession(externalId, sessionId);
    }

    // Track assistant text (for fallback) and log tool usage
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if ("text" in block && typeof block.text === "string" && block.text.trim()) {
          lastAssistantText = block.text;
        }
        if ("type" in block && block.type === "tool_use") {
          const toolBlock = block as { name?: string; input?: unknown };
          console.log(`Tool call: ${toolBlock.name}`, JSON.stringify(toolBlock.input).slice(0, 200));

          // Fire onMessage immediately when agent calls message_user
          if (onMessage && toolBlock.name === "mcp__send-message__message_user") {
            const input = toolBlock.input as { text?: string } | undefined;
            if (input?.text) {
              onMessage(input.text);
            }
          }
        }
      }
    }

    // Handle streaming text deltas
    if (message.type === "stream_event" && onTextDelta) {
      const event = message.event as { type: string; delta?: { type: string; text?: string }; content_block?: { type: string } };
      if (event.type === "content_block_start" && event.content_block?.type === "text") {
        isStreamingTextBlock = true;
        streamingText = "";
      } else if (event.type === "content_block_delta" && isStreamingTextBlock && event.delta?.type === "text_delta" && event.delta.text) {
        streamingText += event.delta.text;
        onTextDelta(streamingText);
      } else if (event.type === "content_block_stop") {
        isStreamingTextBlock = false;
      }
    }

    // Log tool progress/errors
    if (message.type === "tool_progress") {
      const msg = message as { tool_name?: string; data?: string };
      if (msg.tool_name) {
        console.log(`Tool progress (${msg.tool_name}):`, (msg.data || "").slice(0, 200));
      }
    }

    // Reset streaming text when a new assistant message starts (new turn after tool use)
    if (message.type === "assistant") {
      streamingText = "";
      isStreamingTextBlock = false;
    }

    // Use the SDK's final result instead of capturing intermediate text
    if (message.type === "result") {
      console.log(`Done: ${message.subtype}`);
      if ("result" in message && typeof message.result === "string") {
        result = message.result;
      }
    }
  }

  if (!sessionId) {
    throw new Error("No session ID received from agent");
  }

  // Collect messages from file (only used when no onMessage callback)
  let collectedMessages: string[] = [];
  if (messageFile) {
    try {
      collectedMessages = JSON.parse(readFileSync(messageFile, "utf-8"));
    } catch {
      // File missing or corrupt — no messages collected
    } finally {
      try { unlinkSync(messageFile); } catch { /* ignore */ }
    }
  }

  const fallbackResult = result || lastAssistantText;
  return {
    result: collectedMessages.length > 0 ? collectedMessages.join("\n\n") : fallbackResult,
    messages: collectedMessages,
    sessionId,
  };
}
