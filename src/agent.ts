import { query } from "@anthropic-ai/claude-agent-sdk";
import { getSession, setSession } from "./sessions.js";
import { env } from "./config.js";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

interface AgentResponse {
  result: string;
  /** Explicit messages sent via the message_user tool. Empty if agent used text output instead. */
  messages: string[];
  /** Whether any messages were delivered in real-time via the onMessage callback. */
  messagesDelivered: boolean;
  sessionId: string;
}

interface RunAgentParams {
  prompt: string;
  externalId: string;
  systemContext?: string;
  /** Called with accumulated text as streaming deltas arrive */
  onTextDelta?: (accumulatedText: string) => void;
  /** Called immediately when the agent sends a message via the message_user tool */
  onMessage?: (text: string) => void;
}

export async function runAgent(params: RunAgentParams): Promise<AgentResponse> {
  const { prompt, externalId, systemContext, onTextDelta, onMessage } = params;

  const existingSession = getSession(externalId);
  let sessionId: string | undefined = existingSession?.agentSessionId;
  let result = "";

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
  };

  // Build allowed tools list
  const allowedTools = [
    "Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch",
    "mcp__send-message__message_user",
    "mcp__todoist__todoist_create_task",
    "mcp__todoist__todoist_list_tasks",
    "mcp__todoist__todoist_complete_task",
    "mcp__todoist__todoist_list_projects",
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
  let messagesDelivered = false;

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
      // System prompt comes entirely from the Obsidian vault (no Claude Code preset).
      // Ephemeral — must be passed on every call including resumes.
      ...(systemContext ? { systemPrompt: systemContext } : {}),
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
          if (toolBlock.name === "mcp__send-message__message_user") {
            const input = toolBlock.input as { text?: string } | undefined;
            if (input?.text) {
              messagesDelivered = true;
              if (onMessage) onMessage(input.text);
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
    messagesDelivered,
    sessionId,
  };
}
