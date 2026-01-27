import { query } from "@anthropic-ai/claude-agent-sdk";
import { getSession, setSession } from "./sessions.js";
import { env } from "./config.js";

interface AgentResponse {
  result: string;
  sessionId: string;
}

export interface ProgressEvent {
  type: "start" | "tool_call" | "tool_progress" | "done";
  toolName?: string;
  message: string;
}

interface RunAgentParams {
  prompt: string;
  externalId: string;
  systemContext?: string;
  onProgress?: (event: ProgressEvent) => void;
  timeoutMs?: number;
}

const FRIENDLY_TOOL_NAMES: Record<string, string> = {
  Read: "Reading files",
  Write: "Writing files",
  Edit: "Editing files",
  Bash: "Running commands",
  Glob: "Searching files",
  Grep: "Searching code",
  WebSearch: "Searching the web",
  WebFetch: "Fetching web content",
  mcp__todoist__todoist_create_task: "Creating Todoist task",
  mcp__todoist__todoist_list_tasks: "Checking Todoist tasks",
  mcp__todoist__todoist_complete_task: "Completing Todoist task",
  mcp__todoist__todoist_list_projects: "Listing Todoist projects",
};

function friendlyToolName(toolName: string): string {
  return FRIENDLY_TOOL_NAMES[toolName] || toolName;
}

export async function runAgent(params: RunAgentParams): Promise<AgentResponse> {
  const { prompt, externalId, systemContext, onProgress, timeoutMs } = params;

  const existingSession = getSession(externalId);
  let sessionId: string | undefined = existingSession?.agentSessionId;
  let result = "";

  const fullPrompt = systemContext ? `${systemContext}\n\n${prompt}` : prompt;

  const execute = async (): Promise<AgentResponse> => {
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
        onProgress?.({ type: "start", message: "Processing..." });
      }

      // Log tool usage for debugging and fire progress events
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            result = block.text as string;
          }
          if ("type" in block && block.type === "tool_use") {
            const toolBlock = block as { name?: string; input?: unknown };
            const name = toolBlock.name || "unknown";
            console.log(`Tool call: ${name}`, JSON.stringify(toolBlock.input).slice(0, 200));
            onProgress?.({
              type: "tool_call",
              toolName: name,
              message: friendlyToolName(name),
            });
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
        onProgress?.({ type: "done", message: "Complete" });
      }
    }

    if (!sessionId) {
      throw new Error("No session ID received from agent");
    }

    return { result, sessionId };
  };

  if (timeoutMs) {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Agent timed out after ${Math.round(timeoutMs / 1000)}s`)),
        timeoutMs
      );
    });
    return Promise.race([execute(), timeoutPromise]);
  }

  return execute();
}
