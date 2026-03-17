import { query } from "@anthropic-ai/claude-agent-sdk";
import { getSession, setSession } from "./sessions.js";
import { env } from "./config.js";

interface AgentResponse {
  result: string;
  sessionId: string;
}

interface RunAgentParams {
  prompt: string;
  externalId: string;
  systemContext?: string;
  /** Called with accumulated text as streaming deltas arrive */
  onTextDelta?: (accumulatedText: string) => void;
}

export async function runAgent(params: RunAgentParams): Promise<AgentResponse> {
  const { prompt, externalId, systemContext, onTextDelta } = params;

  const existingSession = getSession(externalId);
  let sessionId: string | undefined = existingSession?.agentSessionId;
  let result = "";

  const fullPrompt = systemContext ? `${systemContext}\n\n${prompt}` : prompt;

  // Build MCP servers config
  const mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }> = {
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

  for await (const message of query({
    prompt: fullPrompt,
    options: {
      model: "claude-sonnet-4-6",
      allowedTools,
      permissionMode: "acceptEdits",
      settingSources: ["project"],
      cwd: process.env.AGENT_CWD || "/app",
      mcpServers,
      includePartialMessages: !!onTextDelta,
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

    // Log tool usage for debugging
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if ("text" in block) {
          result = block.text as string;
        }
        if ("type" in block && block.type === "tool_use") {
          const toolBlock = block as { name?: string; input?: unknown };
          console.log(`Tool call: ${toolBlock.name}`, JSON.stringify(toolBlock.input).slice(0, 200));
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

    if (message.type === "result") {
      console.log(`Done: ${message.subtype}`);
    }
  }

  if (!sessionId) {
    throw new Error("No session ID received from agent");
  }

  return { result, sessionId };
}
