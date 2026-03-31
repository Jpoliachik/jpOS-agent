/**
 * Ramble recording processing pipeline.
 * Saves audio, transcribes, logs to vault, runs agent, notifies via Telegram.
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { transcribeAudio } from "./transcription.js";
import { pushVaultChanges, appendVoiceNote } from "./obsidian.js";
import { buildSystemContext } from "./instructions.js";
import { runAgent } from "./agent.js";
import { completeJob, failJob } from "./ramble-jobs.js";
import { sendTelegramMessage } from "./interfaces/telegram.js";

const RECORDINGS_DIR = "/data/ramble-recordings";
const TRANSCRIPTION_TIMEOUT_MS = 60_000; // 60 seconds
const AGENT_TIMEOUT_MS = 5 * 60_000; // 5 minutes

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms),
    ),
  ]);
}

interface ProcessRecordingParams {
  id: string;
  audioBuffer: Buffer;
  createdAt: string;
  duration: number;
}

export async function processRecording(params: ProcessRecordingParams): Promise<void> {
  const { id, audioBuffer, createdAt, duration } = params;

  try {
    // 1. Save audio file
    console.log(`[ramble:${id}] Saving audio file...`);
    if (!existsSync(RECORDINGS_DIR)) {
      mkdirSync(RECORDINGS_DIR, { recursive: true });
    }
    const audioPath = join(RECORDINGS_DIR, `${id}.m4a`);
    writeFileSync(audioPath, audioBuffer);
    console.log(`[ramble:${id}] Audio saved (${audioBuffer.length} bytes)`);

    // 2. Transcribe (60s timeout)
    console.log(`[ramble:${id}] Starting transcription...`);
    const transcription = await withTimeout(
      transcribeAudio(audioPath),
      TRANSCRIPTION_TIMEOUT_MS,
      "Transcription timed out",
    );
    const transcript = transcription.text;
    console.log(`[ramble:${id}] Transcription complete (${transcript.length} chars)`);

    // 3. Save voice note to vault (push immediately so it persists even if agent fails)
    console.log(`[ramble:${id}] Saving to vault...`);
    const timestamp = createdAt
      ? new Date(createdAt).toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      : undefined;

    appendVoiceNote({ transcript, timestamp, duration, id, createdAt });
    await pushVaultChanges();
    console.log(`[ramble:${id}] Vault saved`);

    // 4. Run agent processing (5 min timeout)
    console.log(`[ramble:${id}] Running agent...`);
    const systemContext = buildSystemContext("voice-note", { transcript });
    const result = await withTimeout(
      runAgent({
        prompt: "Process the voice note transcript described in your instructions.",
        externalId: "api:voice-notes",
        systemContext,
      }).then(async (r) => {
        await pushVaultChanges();
        return r.messages.length > 0 ? r.messages.join("\n\n") : r.result;
      }),
      AGENT_TIMEOUT_MS,
      "Agent processing timed out",
    );
    console.log(`[ramble:${id}] Agent complete`);

    const agentNotes = result || "Voice note processed.";

    // 5. Mark job complete
    completeJob({ id, transcription: transcript, agentNotes });
    console.log(`[ramble:${id}] Job completed successfully`);

    // 6. Notify via Telegram
    await sendTelegramMessage(agentNotes);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ramble:${id}] Processing failed: ${errorMsg}`);
    failJob({ id, error: errorMsg });
    await sendTelegramMessage(`jpOS: Ramble processing failed: ${errorMsg}`).catch(() => {});
  }
}

export function deleteRecordingAudio(id: string): void {
  const audioPath = join(RECORDINGS_DIR, `${id}.m4a`);
  try {
    unlinkSync(audioPath);
  } catch {
    // File may not exist — that's fine
  }
}
