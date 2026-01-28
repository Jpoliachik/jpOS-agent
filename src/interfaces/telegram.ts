import { Bot, Context } from "grammy";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { clearSession } from "../sessions.js";
import { ensureVaultPushed, VAULT_PATH } from "../obsidian.js";

let botInstance: Bot | null = null;

function buildTelegramSystemContext(): string {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  return `CRITICAL: You MUST use tools for every action. NEVER fabricate responses.

Before responding, read these files IN ORDER:
1. /app/agent-context/SOUL.md — your identity and hard rules
2. /app/agent-context/INSTRUCTIONS.md — what to do and how
3. All .md files in ${VAULT_PATH}/context/ — current user context (use Glob then Read)

Today's date: ${today}
Obsidian vault path: ${VAULT_PATH}`;
}

export function createTelegramBot(): Bot {
  const bot = new Bot(env.telegramBotToken);
  botInstance = bot;

  // Auth middleware - only allow configured user
  bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (userId !== env.allowedTelegramUserId) {
      console.log(`Rejected unauthorized user: ${userId}`);
      return;
    }
    await next();
  });

  // Command: /start
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "jpOS Agent ready. Send me a message to start a conversation.\n\n" +
        "Commands:\n" +
        "/new - Start a fresh conversation\n" +
        "/status - Check agent status"
    );
  });

  // Command: /new - Clear session and start fresh
  bot.command("new", async (ctx) => {
    const externalId = `telegram:${ctx.from!.id}`;
    clearSession(externalId);
    await ctx.reply("Session cleared. Starting fresh conversation.");
  });

  // Command: /status
  bot.command("status", async (ctx) => {
    await ctx.reply("Agent is running.");
  });

  // Handle all text messages
  bot.on("message:text", async (ctx) => {
    const externalId = `telegram:${ctx.from!.id}`;
    const userMessage = ctx.message.text;

    // Send typing indicator
    await ctx.replyWithChatAction("typing");

    try {
      const systemContext = buildTelegramSystemContext();

      const response = await runAgent({
        prompt: userMessage,
        externalId,
        systemContext,
      });

      await ensureVaultPushed();

      await ctx.reply(response.result || "Done.", {
        parse_mode: "Markdown",
      });
    } catch (error) {
      console.error("Agent error:", error);
      await ctx.reply(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  });

  return bot;
}

export async function sendTelegramMessage(text: string): Promise<void> {
  if (!botInstance) {
    console.error("Telegram bot not initialized");
    return;
  }

  try {
    await botInstance.api.sendMessage(env.allowedTelegramUserId, text, {
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
  }
}
