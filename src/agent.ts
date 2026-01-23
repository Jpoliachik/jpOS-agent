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

  const options: Record<string, unknown> = {
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"],
    permissionMode: "bypassPermissions",
    mcpServers: {
      todoist: {
        command: "node",
        args: ["./dist/mcp/todoist.js"],
        env: {
          TODOIST_API_TOKEN: env.todoistApiToken,
        },
      },
    },
  };

  if (sessionId) {
    options.resume = sessionId;
  }

  for await (const message of query({ prompt: fullPrompt, options })) {
    // Capture session ID from init message
    if (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      message.type === "system" &&
      "subtype" in message &&
      message.subtype === "init" &&
      "session_id" in message
    ) {
      sessionId = message.session_id as string;
      setSession(externalId, sessionId);
    }

    // Capture final result
    if (typeof message === "object" && message !== null && "result" in message) {
      result = message.result as string;
    }
  }

  if (!sessionId) {
    throw new Error("No session ID received from agent");
  }

  return { result, sessionId };
}
