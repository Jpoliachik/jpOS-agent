import { Bot, Context } from "grammy";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { clearSession } from "../sessions.js";
import { pushVaultChanges, appendVoiceNote } from "../obsidian.js";
import { transcribeAudio } from "../transcription.js";
import { buildSystemContext } from "../prompt.js";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let botInstance: Bot | null = null;

/** Send after 3s of silence, or 10s max from first message — whichever comes first */
const MESSAGE_DEBOUNCE_MS = 3000;
const MESSAGE_MAX_WAIT_MS = 10000;

interface UserMessageQueue {
  pending: string[];       // Messages waiting for debounce to fire
  debounceTimer: ReturnType<typeof setTimeout> | null;
  maxWaitTimer: ReturnType<typeof setTimeout> | null;
  processing: boolean;     // Agent is currently running
  queued: string[];        // Messages that arrived while agent was running
  ctx: Context | null;     // Latest context for replying
  stopTyping: (() => void) | null;
}

const userQueues = new Map<string, UserMessageQueue>();

function getOrCreateQueue(externalId: string): UserMessageQueue {
  let queue = userQueues.get(externalId);
  if (!queue) {
    queue = {
      pending: [],
      debounceTimer: null,
      maxWaitTimer: null,
      processing: false,
      queued: [],
      ctx: null,
      stopTyping: null,
    };
    userQueues.set(externalId, queue);
  }
  return queue;
}

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

/**
 * Creates an onMessage callback that sends messages to Telegram immediately.
 * Clears the streaming draft and typing indicator on first message.
 * Uses a sequential queue to preserve message ordering.
 */
function createOnMessageHandler(
  ctx: Context,
  finalize: () => Promise<void>,
  getStopTyping: () => (() => void) | null,
  setStopTyping: (fn: (() => void) | null) => void,
): (text: string) => void {
  let sendQueue = Promise.resolve();
  return (text: string) => {
    sendQueue = sendQueue.then(async () => {
      try {
        await finalize();
        getStopTyping()?.();
        setStopTyping(null);
        await sendWithMarkdownFallback((parseMode) =>
          ctx.reply(text, {
            ...(parseMode && { parse_mode: parseMode as "Markdown" }),
          }),
        );
      } catch (error) {
        console.error("Failed to send message_user message:", error);
      }
    });
  };
}

/** Clear both timers on a queue. */
function clearQueueTimers(queue: UserMessageQueue) {
  if (queue.debounceTimer) {
    clearTimeout(queue.debounceTimer);
    queue.debounceTimer = null;
  }
  if (queue.maxWaitTimer) {
    clearTimeout(queue.maxWaitTimer);
    queue.maxWaitTimer = null;
  }
}

/**
 * Enqueue a text message for batched processing.
 * - If agent is idle: buffer message and start/reset debounce timer.
 *   A max-wait timer fires after 10s from the first message regardless.
 * - If agent is busy: queue message for after it finishes.
 */
function enqueueTextMessage(externalId: string, text: string, ctx: Context) {
  const queue = getOrCreateQueue(externalId);
  queue.ctx = ctx;

  if (queue.processing) {
    queue.queued.push(text);
    console.log(`Message queued (agent busy): "${text.slice(0, 50)}" (${queue.queued.length} queued)`);
    return;
  }

  const isFirst = queue.pending.length === 0;
  queue.pending.push(text);

  // Reset the debounce (silence) timer on every message
  if (queue.debounceTimer) {
    clearTimeout(queue.debounceTimer);
  }

  // Start typing on first message
  if (!queue.stopTyping) {
    queue.stopTyping = startTypingIndicator(ctx);
  }

  console.log(`Message buffered: "${text.slice(0, 50)}" (${queue.pending.length} pending, waiting ${MESSAGE_DEBOUNCE_MS}ms debounce)`);

  queue.debounceTimer = setTimeout(() => {
    clearQueueTimers(queue);
    processMessageQueue(externalId, queue);
  }, MESSAGE_DEBOUNCE_MS);

  // Start max-wait timer only on the first message of a batch
  if (isFirst) {
    queue.maxWaitTimer = setTimeout(() => {
      console.log(`Max wait reached (${MESSAGE_MAX_WAIT_MS}ms) — flushing ${queue.pending.length} message(s)`);
      clearQueueTimers(queue);
      processMessageQueue(externalId, queue);
    }, MESSAGE_MAX_WAIT_MS);
  }
}

/** Flush pending messages into a single agent call. */
async function processMessageQueue(externalId: string, queue: UserMessageQueue) {
  const messages = queue.pending.splice(0);
  if (messages.length === 0) return;

  queue.processing = true;
  const ctx = queue.ctx!;

  if (!queue.stopTyping) {
    queue.stopTyping = startTypingIndicator(ctx);
  }

  const combinedPrompt = messages.length === 1
    ? messages[0]
    : messages.map((m, i) => `[Message ${i + 1}]: ${m}`).join("\n\n");

  console.log(`Processing ${messages.length} batched message(s) for ${externalId}`);

  const { onTextDelta, finalize } = botInstance
    ? createStreamingDraft(ctx.chat!.id, botInstance)
    : { onTextDelta: undefined, finalize: async () => {} };

  const onMessage = createOnMessageHandler(
    ctx, finalize,
    () => queue.stopTyping,
    (fn) => { queue.stopTyping = fn; },
  );

  try {
    const systemContext = buildSystemContext("message");
    const response = await runAgent({
      prompt: combinedPrompt,
      externalId,
      systemContext,
      onTextDelta,
      onMessage,
    });

    await pushVaultChanges();
    await finalize();
    queue.stopTyping?.();
    queue.stopTyping = null;

    // Send final result too (agent can control this via prompt instructions)
    if (response.result) {
      await sendWithMarkdownFallback((parseMode) =>
        ctx.reply(response.result, {
          ...(parseMode && { parse_mode: parseMode as "Markdown" }),
        }),
      );
    }
  } catch (error) {
    await finalize();
    queue.stopTyping?.();
    queue.stopTyping = null;
    console.error("Agent error:", error);
    await ctx.reply(
      `jpOS: Error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  } finally {
    queue.processing = false;

    // If messages arrived while agent was running, start a new cycle with both timers
    if (queue.queued.length > 0) {
      queue.pending = queue.queued.splice(0);
      queue.stopTyping = startTypingIndicator(ctx);
      console.log(`Starting new debounce cycle with ${queue.pending.length} queued message(s)`);
      queue.debounceTimer = setTimeout(() => {
        clearQueueTimers(queue);
        processMessageQueue(externalId, queue);
      }, MESSAGE_DEBOUNCE_MS);
      queue.maxWaitTimer = setTimeout(() => {
        console.log(`Max wait reached (${MESSAGE_MAX_WAIT_MS}ms) — flushing ${queue.pending.length} message(s)`);
        clearQueueTimers(queue);
        processMessageQueue(externalId, queue);
      }, MESSAGE_MAX_WAIT_MS);
    }
  }
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
    let stopTyping: (() => void) | null = startTypingIndicator(ctx);

    const onMessage = createOnMessageHandler(
      ctx, finalize,
      () => stopTyping,
      (fn) => { stopTyping = fn; },
    );

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
        onMessage,
      });

      await pushVaultChanges();
      await finalize();
      stopTyping?.();
      stopTyping = null;

      if (agentResponse.result) {
        await sendWithMarkdownFallback((parseMode) =>
          ctx.reply(agentResponse.result, {
            ...(parseMode && { parse_mode: parseMode as "Markdown" }),
          }),
        );
      }
    } catch (error) {
      await finalize();
      stopTyping?.();
      console.error("Photo message error:", error);
      await ctx.reply(
        `jpOS: Error: ${error instanceof Error ? error.message : "Unknown error"}`
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

  // Handle all text messages — uses accumulator to batch rapid-fire messages
  bot.on("message:text", (ctx) => {
    const externalId = `telegram:${ctx.from!.id}`;
    enqueueTextMessage(externalId, ctx.message.text, ctx);
  });

  // Handle voice messages
  bot.on("message:voice", async (ctx) => {
    const voice = ctx.message.voice;
    let tempFilePath: string | null = null;

    let stopTyping: (() => void) | null = startTypingIndicator(ctx);
    const noopFinalize = async () => {};
    const onMessage = createOnMessageHandler(
      ctx, noopFinalize,
      () => stopTyping,
      (fn) => { stopTyping = fn; },
    );

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
          onMessage,
        });
        await pushVaultChanges();
      }

      stopTyping?.();
      stopTyping = null;

      if (agentResponse.result) {
        await sendWithMarkdownFallback((parseMode) =>
          ctx.reply(agentResponse.result, {
            ...(parseMode && { parse_mode: parseMode as "Markdown" }),
          }),
        );
      }
    } catch (error) {
      stopTyping?.();
      console.error("Voice message error:", error);
      await ctx.reply(
        `jpOS: Error processing voice message: ${error instanceof Error ? error.message : "Unknown error"}`
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
