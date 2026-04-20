/**
 * Ramble webhook processing pipeline.
 * Logs transcript to vault, runs agent, notifies via Telegram.
 */

import { appendVoiceNote } from "./obsidian.js";
import { requestSync } from "./vault-sync.js";
import { buildSystemContext } from "./prompt.js";
import { runAgent } from "./agent.js";
import { sendTelegramMessage } from "./interfaces/telegram.js";

const AGENT_TIMEOUT_MS = 5 * 60_000; // 5 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

interface ProcessWebhookParams {
  recordingId: string;
  transcript: string;
  createdAt: string;
  duration: number;
}

// Serialize webhook processing so concurrent git ops don't collide
let queue = Promise.resolve();

export function processWebhook(params: ProcessWebhookParams): Promise<void> {
  const p = queue.then(() => processWebhookImpl(params));
  queue = p.catch(() => {}); // prevent rejected promise from blocking the queue
  return p;
}

async function processWebhookImpl(params: ProcessWebhookParams): Promise<void> {
  const { recordingId, transcript, createdAt, duration } = params;

  try {
    // 1. Save voice note to vault
    console.log(`[ramble:${recordingId}] Saving to vault...`);
    const result = appendVoiceNote({ transcript, duration, id: recordingId, createdAt, source: "ramble" });
    if (result.isDuplicate) {
      console.log(`[ramble:${recordingId}] Duplicate — skipping`);
      return;
    }
    requestSync();
    console.log(`[ramble:${recordingId}] Vault saved`);

    // 2. Skip agent if transcript is empty
    if (!transcript.trim()) {
      console.log(`[ramble:${recordingId}] Empty transcript — skipping agent`);
      return;
    }

    // 3. Run agent processing (5 min timeout)
    console.log(`[ramble:${recordingId}] Running agent...`);
    const systemContext = buildSystemContext("voice-note", { transcript });
    const agentResult = await withTimeout(
      runAgent({
        prompt: "Process the voice note transcript described in your instructions.",
        externalId: `voice-note:${recordingId}`,
        systemContext,
      }).then((r) => {
        requestSync();
        return r.messages.length > 0 ? r.messages.join("\n\n") : r.result;
      }),
      AGENT_TIMEOUT_MS,
      "Agent processing timed out",
    );
    console.log(`[ramble:${recordingId}] Agent complete`);

    // 4. Notify via Telegram
    const output = agentResult || "Voice note processed.";
    await sendTelegramMessage(output);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ramble:${recordingId}] Processing failed: ${errorMsg}`);
    await sendTelegramMessage(`jpOS: Ramble processing failed: ${errorMsg}`).catch(() => {});
  }
}
