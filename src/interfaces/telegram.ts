import { Bot, Context } from "grammy";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { clearSession } from "../sessions.js";

export function createTelegramBot(): Bot {
  const bot = new Bot(env.telegramBotToken);

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
      const response = await runAgent({
        prompt: userMessage,
        externalId,
      });

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
