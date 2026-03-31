#!/usr/bin/env node
/**
 * Send Message MCP Server
 *
 * Provides a `send_message` tool that the agent uses to explicitly send
 * user-facing messages. Messages are written to a JSON file so the caller
 * (telegram/api) can collect them after the agent run.
 *
 * Env: JPOS_MESSAGE_FILE — path to the JSON file for collected messages.
 */

import { readFileSync, writeFileSync } from "node:fs";

const MESSAGE_FILE = process.env.JPOS_MESSAGE_FILE;

const tools = [
  {
    name: "message_user",
    description:
      "Send a message to the user (e.g. via Telegram). " +
      "Use this tool for ALL user-facing communication. " +
      "Do NOT rely on your text output reaching the user — only messages sent through this tool will be delivered. " +
      "Be concise and conversational.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The message text to send to the user. Supports Markdown.",
        },
      },
      required: ["text"],
    },
  },
];

function appendMessage(text: string) {
  if (!MESSAGE_FILE) {
    throw new Error("JPOS_MESSAGE_FILE env var not set");
  }
  let messages: string[] = [];
  try {
    messages = JSON.parse(readFileSync(MESSAGE_FILE, "utf-8"));
  } catch {
    // File doesn't exist yet or is empty — start fresh
  }
  messages.push(text);
  writeFileSync(MESSAGE_FILE, JSON.stringify(messages));
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
            serverInfo: { name: "send-message-mcp", version: "1.0.0" },
          };
          break;

        case "tools/list":
          response = { tools };
          break;

        case "tools/call": {
          const { name, arguments: args } = request.params;
          if (name === "message_user") {
            const text = (args?.text as string) || "";
            appendMessage(text);
            response = {
              content: [{ type: "text", text: "Message sent." }],
            };
          } else {
            response = {
              content: [{ type: "text", text: `Unknown tool: ${name}` }],
              isError: true,
            };
          }
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
