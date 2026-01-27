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
}

export async function runAgent(params: RunAgentParams): Promise<AgentResponse> {
  const { prompt, externalId, systemContext } = params;

  const existingSession = getSession(externalId);
  let sessionId: string | undefined = existingSession?.agentSessionId;
  let result = "";

  const fullPrompt = systemContext ? `${systemContext}\n\n${prompt}` : prompt;

  for await (const message of query({
    prompt: fullPrompt,
    options: {
      allowedTools: [
        "Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch",
        "mcp__todoist__todoist_create_task",
        "mcp__todoist__todoist_list_tasks",
        "mcp__todoist__todoist_complete_task",
        "mcp__todoist__todoist_list_projects",
      ],
      permissionMode: "acceptEdits",
      settingSources: ["project"],
      cwd: process.env.AGENT_CWD || "/app",
      mcpServers: {
        todoist: {
          command: "node",
          args: [process.env.MCP_TODOIST_PATH || "/app/dist/mcp/todoist.js"],
          env: {
            TODOIST_API_TOKEN: env.todoistApiToken,
          },
        },
      },
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

    // Log tool progress/errors
    if (message.type === "tool_progress") {
      const msg = message as { tool_name?: string; data?: string };
      if (msg.tool_name) {
        console.log(`Tool progress (${msg.tool_name}):`, (msg.data || "").slice(0, 200));
      }
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
