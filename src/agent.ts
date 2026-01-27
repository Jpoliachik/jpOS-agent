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
      allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch"],
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

    // Print human-readable output (for debugging)
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if ("text" in block) {
          result = block.text as string;
        }
      }
    }

    // Capture final result
    if (message.type === "result") {
      console.log(`Done: ${message.subtype}`);
    }
  }

  if (!sessionId) {
    throw new Error("No session ID received from agent");
  }

  return { result, sessionId };
}
