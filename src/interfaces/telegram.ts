import { Bot, Context } from "grammy";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { clearSession } from "../sessions.js";
import { pushVaultChanges, appendVoiceNote } from "../obsidian.js";
import { transcribeAudio } from "../transcription.js";
import { buildSystemContext } from "../instructions.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let botInstance: Bot | null = null;

/** Counter for unique draft IDs */
let draftIdCounter = 0;

/** Sends "typing..." indicator every 4s until stopped. Returns a stop function. */
function startTypingIndicator(ctx: Context): () => void {
  let active = true;
  const send = () => ctx.replyWithChatAction("typing").catch(() => {});
  send();
  const interval = setInterval(() => {
    if (active) send();
  }, 4000);
  return () => {
    active = false;
    clearInterval(interval);
  };
}

/**
 * Creates a streaming draft handler for progressive message display.
 * Uses Telegram's sendMessageDraft API for native streaming UX.
 * Returns an onTextDelta callback and a finalize function.
 */
function createStreamingDraft(chatId: number, bot: Bot) {
  const draftId = ++draftIdCounter;
  let lastSentText = "";
  let lastSendTime = 0;
  let pendingText = "";
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  const THROTTLE_MS = 300;

  const sendDraft = (text: string) => {
    if (text === lastSentText || text.length === 0) return;
    lastSentText = text;
    lastSendTime = Date.now();
    bot.api.raw.sendMessageDraft({ chat_id: chatId, draft_id: draftId, text }).catch((err: Error) => {
      console.warn("sendMessageDraft error:", err.message);
    });
  };

  const onTextDelta = (accumulatedText: string) => {
    pendingText = accumulatedText;
    const elapsed = Date.now() - lastSendTime;
    if (elapsed >= THROTTLE_MS) {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      sendDraft(pendingText);
    } else if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        sendDraft(pendingText);
      }, THROTTLE_MS - elapsed);
    }
  };

  const finalize = async () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    // Await draft clear so it completes before the final message is sent
    await bot.api.raw.sendMessageDraft({ chat_id: chatId, draft_id: draftId, text: "" }).catch(() => {});
  };

  return { onTextDelta, finalize };
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

  // Handle photo messages
  bot.on("message:photo", async (ctx) => {
    const externalId = `telegram:${ctx.from!.id}`;
    const caption = ctx.message.caption || "The user sent an image with no caption.";

    // Get the largest photo (last in the array)
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];

    const { onTextDelta, finalize } = createStreamingDraft(ctx.chat.id, bot);
    const stopTyping = startTypingIndicator(ctx);

    let tempFilePath: string | null = null;
    try {
      // Download the photo
      const file = await ctx.api.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${env.telegramBotToken}/${file.file_path}`;

      tempFilePath = join(tmpdir(), `photo-${Date.now()}.jpg`);
      const response = await fetch(fileUrl);
      const buffer = await response.arrayBuffer();
      writeFileSync(tempFilePath, Buffer.from(buffer));

      const systemContext = buildSystemContext("message");
      const agentResponse = await runAgent({
        prompt: `The user sent a photo. Read the image file at ${tempFilePath} to see it.\n\nTheir message: ${caption}`,
        externalId,
        systemContext,
        onTextDelta,
      });

      await pushVaultChanges();
      await finalize();
      stopTyping();

      await sendWithMarkdownFallback((parseMode) =>
        ctx.reply(agentResponse.result || "Done.", {
          ...(parseMode && { parse_mode: parseMode as "Markdown" }),
        }),
      );
    } catch (error) {
      await finalize();
      stopTyping();
      console.error("Photo message error:", error);
      await ctx.reply(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    } finally {
      if (tempFilePath) {
        try {
          unlinkSync(tempFilePath);
        } catch (e) {
          console.error("Failed to delete temp file:", e);
        }
      }
    }
  });

  // Handle all text messages
  bot.on("message:text", async (ctx) => {
    const externalId = `telegram:${ctx.from!.id}`;
    const userMessage = ctx.message.text;

    const { onTextDelta, finalize } = createStreamingDraft(ctx.chat.id, bot);
    const stopTyping = startTypingIndicator(ctx);

    try {
      const systemContext = buildSystemContext("message");
      const response = await runAgent({
        prompt: userMessage,
        externalId,
        systemContext,
        onTextDelta,
      });

      await pushVaultChanges();
      await finalize();
      stopTyping();

      await sendWithMarkdownFallback((parseMode) =>
        ctx.reply(response.result || "Done.", {
          ...(parseMode && { parse_mode: parseMode as "Markdown" }),
        }),
      );
    } catch (error) {
      await finalize();
      stopTyping();
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

    const stopTyping = startTypingIndicator(ctx);

    try {
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

      const { isDuplicate } = appendVoiceNote({
        transcript: transcription.text,
        duration: transcription.duration,
      });

      let agentResponse: { result: string };
      if (isDuplicate) {
        agentResponse = { result: "Duplicate voice note — already logged." };
      } else {
        const systemContext = buildSystemContext("voice-note", {
          transcript: transcription.text,
        });
        agentResponse = await runAgent({
          prompt: "Process the voice note transcript described in your instructions.",
          externalId: "api:voice-notes",
          systemContext,
        });
        await pushVaultChanges();
      }

      stopTyping();

      await sendWithMarkdownFallback((parseMode) =>
        ctx.reply(
          agentResponse.result || "Voice note logged and processed.",
          {
            ...(parseMode && { parse_mode: parseMode as "Markdown" }),
          },
        ),
      );
    } catch (error) {
      stopTyping();
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

async function sendWithMarkdownFallback(
  sendFn: (parseMode?: string) => Promise<unknown>,
): Promise<void> {
  try {
    await sendFn("Markdown");
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("can't parse entities")
    ) {
      console.warn(
        "Markdown parse failed, retrying without parse_mode:",
        error.message,
      );
      await sendFn(undefined);
    } else {
      throw error;
    }
  }
}

export async function sendTelegramTypingIndicator(): Promise<void> {
  if (!botInstance) return;
  try {
    await botInstance.api.sendChatAction(env.allowedTelegramUserId, "typing");
  } catch (error) {
    console.error("Failed to send typing indicator:", error);
  }
}

export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!botInstance) {
    console.error("Telegram bot not initialized — message not sent:", text.slice(0, 100));
    return false;
  }

  try {
    await sendWithMarkdownFallback((parseMode) =>
      botInstance!.api.sendMessage(env.allowedTelegramUserId, text, {
        ...(parseMode && { parse_mode: parseMode as "Markdown" }),
      }),
    );
    return true;
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
    return false;
  }
}
