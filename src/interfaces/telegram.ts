import { Bot, Context } from "grammy";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { clearSession } from "../sessions.js";
import { ensureVaultPushed, appendVoiceNote, commitAndPush } from "../obsidian.js";
import { transcribeAudio } from "../transcription.js";
import { buildSystemContext } from "../instructions.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let botInstance: Bot | null = null;

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

    // Send immediate acknowledgment
    await ctx.reply("Got it, working on it...");

    // Send typing indicator
    await ctx.replyWithChatAction("typing");

    try {
      const systemContext = buildSystemContext("message");

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

  // Handle voice messages
  bot.on("message:voice", async (ctx) => {
    const voice = ctx.message.voice;
    let tempFilePath: string | null = null;

    try {
      await ctx.reply("🎤 Transcribing voice message...");

      // Download voice file
      const file = await ctx.api.getFile(voice.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${env.telegramBotToken}/${file.file_path}`;

      // Download to temp file
      tempFilePath = join(tmpdir(), `voice-${Date.now()}.ogg`);
      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      writeFileSync(tempFilePath, Buffer.from(buffer));

      // Transcribe with Groq
      const transcription = await transcribeAudio(tempFilePath);

      // Save to Obsidian vault
      const { filePath, isDuplicate } = await appendVoiceNote({
        transcript: transcription.text,
        duration: transcription.duration,
      });

      if (!isDuplicate) {
        const dateStr = new Date().toISOString().split("T")[0];
        await commitAndPush(`Voice note ${dateStr}`);
        console.log(`Voice message saved to ${filePath}`);
      }

      // Process with agent (same as API voice-note endpoint)
      const systemContext = buildSystemContext("voice-note", {
        transcript: transcription.text,
      });

      const agentResponse = await runAgent({
        prompt: "Process the voice note transcript described in your instructions.",
        externalId: "api:voice-notes",
        systemContext,
      });

      await ensureVaultPushed();

      await ctx.reply(
        agentResponse.result || "Voice note logged and processed.",
        {
          parse_mode: "Markdown",
        }
      );
    } catch (error) {
      console.error("Voice message error:", error);
      await ctx.reply(
        `Error processing voice message: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      // Clean up temp file
      if (tempFilePath) {
        try {
          unlinkSync(tempFilePath);
        } catch (e) {
          console.error("Failed to delete temp file:", e);
        }
      }
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
