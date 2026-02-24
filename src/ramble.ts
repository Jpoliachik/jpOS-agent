/**
 * Ramble recording processing pipeline.
 * Saves audio, transcribes, logs to vault, runs agent, notifies via Telegram.
 */

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { transcribeAudio } from "./transcription.js";
import { withVaultSync, appendVoiceNote } from "./obsidian.js";
import { buildSystemContext } from "./instructions.js";
import { runAgent } from "./agent.js";
import { completeJob, failJob } from "./ramble-jobs.js";
import { sendTelegramMessage } from "./interfaces/telegram.js";

const RECORDINGS_DIR = "/data/ramble-recordings";

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
    if (!existsSync(RECORDINGS_DIR)) {
      mkdirSync(RECORDINGS_DIR, { recursive: true });
    }
    const audioPath = join(RECORDINGS_DIR, `${id}.m4a`);
    writeFileSync(audioPath, audioBuffer);

    // 2. Transcribe
    const transcription = await transcribeAudio(audioPath);
    const transcript = transcription.text;

    // 3. Save voice note to vault (separate sync so it persists even if agent fails)
    const timestamp = createdAt
      ? new Date(createdAt).toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      : undefined;

    await withVaultSync(async () => {
      appendVoiceNote({ transcript, timestamp, duration, id, createdAt });
    });

    // 4. Run agent processing
    const result = await withVaultSync(async () => {
      const systemContext = buildSystemContext("voice-note", { transcript });
      const response = await runAgent({
        prompt: "Process the voice note transcript described in your instructions.",
        externalId: "api:voice-notes",
        systemContext,
      });
      return response.result;
    });

    const agentNotes = result || "Voice note processed.";

    // 5. Mark job complete
    completeJob({ id, transcription: transcript, agentNotes });

    // 6. Notify via Telegram
    await sendTelegramMessage(agentNotes);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    failJob({ id, error: errorMsg });
    await sendTelegramMessage(`Ramble processing failed: ${errorMsg}`).catch(() => {});
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
