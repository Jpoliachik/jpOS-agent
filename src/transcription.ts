/**
 * Audio transcription service using Groq Whisper API
 */

import Groq from "groq-sdk";
import { env } from "./config.js";
import { createReadStream } from "node:fs";

const groq = new Groq({
  apiKey: env.groqApiKey,
});

export interface TranscriptionResult {
  text: string;
  duration?: number;
}

export async function transcribeAudio(
  filePath: string
): Promise<TranscriptionResult> {
  try {
    const transcription = await groq.audio.transcriptions.create({
      file: createReadStream(filePath),
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
    });

    return {
      text: transcription.text,
      duration: (transcription as any).duration,
    };
  } catch (error) {
    console.error("Transcription error:", error);
    throw new Error(
      `Failed to transcribe audio: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
