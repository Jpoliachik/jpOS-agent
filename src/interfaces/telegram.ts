import { Bot, Context } from "grammy";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { clearSession } from "../sessions.js";
import { readContextFiles, readVaultGuide, VAULT_PATH } from "../obsidian.js";

let botInstance: Bot | null = null;

function buildTelegramSystemContext(): string {
  const contextFiles = readContextFiles();
  const vaultGuide = readVaultGuide();

  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });

  const contextSection = contextFiles
    ? `\n## Context Files\nThese files reflect Justin's current state — priorities, people, and goals. Use this awareness in your responses.\n\n${contextFiles}\n`
    : "";

  const vaultGuideSection = vaultGuide
    ? `\n## Vault Conventions\n${vaultGuide}\n`
    : "";

  return `You are jpOS, Justin's personal AI assistant. Today is ${today}.
You have access to Justin's Obsidian vault at: ${VAULT_PATH}
${contextSection}${vaultGuideSection}
## Updating Context Files
When you learn new information from the conversation, update the relevant context files:
- **context/current-focus.md** — Update when priorities shift, new tasks take focus, or something is completed.
- **context/people.md** — Update when new people are mentioned with context, or relationships/roles change.
- **context/goals.md** — Update when goals are declared, intentions expressed, goals completed, or direction shifts.

After modifying any vault files, commit and push:
cd ${VAULT_PATH} && git add -A && git commit -m "Update context" && git push`;
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
