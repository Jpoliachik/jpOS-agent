#!/usr/bin/env node
/**
 * Simple Todoist MCP Server
 * Provides tools for interacting with Todoist API
 */

import { createServer } from "node:http";

const TODOIST_API_TOKEN = process.env.TODOIST_API_TOKEN;
const TODOIST_API_BASE = "https://api.todoist.com/rest/v2";

interface TodoistTask {
  content: string;
  description?: string;
  due_string?: string;
  priority?: number;
  project_id?: string;
  labels?: string[];
}

async function todoistRequest(
  endpoint: string,
  method: string = "GET",
  body?: unknown
): Promise<unknown> {
  const response = await fetch(`${TODOIST_API_BASE}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${TODOIST_API_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Todoist API error: ${response.status} ${response.statusText}`);
  }

  if (response.status === 204) {
    return { success: true };
  }

  return response.json();
}

// MCP Protocol implementation
const tools = [
  {
    name: "todoist_list_tasks",
    description: "List tasks from Todoist. Optionally filter by project or label.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Filter by project ID" },
        label: { type: "string", description: "Filter by label name" },
        filter: { type: "string", description: "Todoist filter query (e.g., 'today', 'overdue')" },
      },
    },
  },
  {
    name: "todoist_create_task",
    description: "Create a new task in Todoist",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Task title/content" },
        description: { type: "string", description: "Task description" },
        due_string: { type: "string", description: "Due date (e.g., 'tomorrow', 'next monday')" },
        priority: { type: "number", description: "Priority 1-4 (4 is highest)" },
        project_id: { type: "string", description: "Project ID to add task to" },
        labels: { type: "array", items: { type: "string" }, description: "Labels to add" },
      },
      required: ["content"],
    },
  },
  {
    name: "todoist_complete_task",
    description: "Mark a task as complete",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "Task ID to complete" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "todoist_list_projects",
    description: "List all projects in Todoist",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "todoist_list_tasks": {
      let endpoint = "/tasks";
      const params = new URLSearchParams();
      if (args.project_id) params.append("project_id", args.project_id as string);
      if (args.label) params.append("label", args.label as string);
      if (args.filter) params.append("filter", args.filter as string);
      if (params.toString()) endpoint += `?${params.toString()}`;
      return todoistRequest(endpoint);
    }

    case "todoist_create_task": {
      const task: TodoistTask = {
        content: args.content as string,
        description: args.description as string | undefined,
        due_string: args.due_string as string | undefined,
        priority: args.priority as number | undefined,
        project_id: args.project_id as string | undefined,
        labels: args.labels as string[] | undefined,
      };
      return todoistRequest("/tasks", "POST", task);
    }

    case "todoist_complete_task": {
      return todoistRequest(`/tasks/${args.task_id}/close`, "POST");
    }

    case "todoist_list_projects": {
      return todoistRequest("/projects");
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Simple stdio-based MCP server
async function main() {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    try {
      const request = JSON.parse(line);
      let response: unknown;

      switch (request.method) {
        case "initialize":
          response = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "todoist-mcp", version: "1.0.0" },
          };
          break;

        case "tools/list":
          response = { tools };
          break;

        case "tools/call":
          const result = await handleToolCall(request.params.name, request.params.arguments || {});
          response = {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
          break;

        default:
          response = { error: { code: -32601, message: "Method not found" } };
      }

      console.log(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: response }));
    } catch (error) {
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: error instanceof Error ? error.message : "Unknown error" },
        })
      );
    }
  }
}

main().catch(console.error);
