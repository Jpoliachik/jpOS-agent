import Fastify from "fastify";
import multipart from "@fastify/multipart";
import bearerAuth from "@fastify/bearer-auth";
import { env } from "../config.js";
import { runAgent } from "../agent.js";
import { withVaultSync } from "../obsidian.js";
import { createJob, getJob, deleteJob } from "../ramble-jobs.js";
import { processRecording, deleteRecordingAudio } from "../ramble.js";

export async function createApiServer() {
  const server = Fastify({ logger: true });

  await server.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  // Health check (no auth required)
  server.get("/health", async () => {
    return { status: "ok" };
  });

  // Register authenticated routes in a separate scope
  await server.register(async (app) => {
    await app.register(bearerAuth, {
      keys: new Set([env.apiBearerToken]),
    });

    // Main agent endpoint
    app.post<{
      Body: {
        prompt: string;
        clientId?: string;
        context?: string;
      };
    }>("/agent", async (request, reply) => {
      const { prompt, clientId, context } = request.body;

      if (!prompt) {
        return reply.status(400).send({ error: "prompt is required" });
      }

      const externalId = `api:${clientId || "default"}`;

      try {
        const response = await withVaultSync(async () => {
          return runAgent({
            prompt,
            externalId,
            systemContext: context,
          });
        });

        return {
          result: response.result,
          sessionId: response.sessionId,
        };
      } catch (error) {
        console.error("Agent error:", error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Ramble: upload a recording for processing
    app.post("/ramble/recordings", async (request, reply) => {
      const audioFile = await request.file();

      if (!audioFile) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      // Parse metadata from the multipart fields
      const metadataField = audioFile.fields.metadata;
      let metadata: { id: string; created_at: string; duration: number };

      try {
        if (
          metadataField &&
          "value" in metadataField &&
          typeof metadataField.value === "string"
        ) {
          metadata = JSON.parse(metadataField.value);
        } else {
          return reply.status(400).send({ error: "metadata field is required" });
        }
      } catch {
        return reply.status(400).send({ error: "Invalid metadata JSON" });
      }

      if (!metadata.id) {
        return reply.status(400).send({ error: "metadata.id is required" });
      }

      // Create job (throws if duplicate)
      try {
        createJob(metadata.id);
      } catch {
        return reply.status(409).send({ error: "Recording already exists" });
      }

      const audioBuffer = await audioFile.toBuffer();

      // Fire async — don't block response
      processRecording({
        id: metadata.id,
        audioBuffer,
        createdAt: metadata.created_at,
        duration: metadata.duration,
      }).catch((err) => {
        console.error("processRecording unexpected error:", err);
      });

      return reply.status(202).send({
        id: metadata.id,
        status: "processing",
      });
    });

    // Ramble: poll for recording status
    app.get<{ Params: { id: string } }>("/ramble/recordings/:id", async (request, reply) => {
      const job = getJob(request.params.id);

      if (!job) {
        return reply.status(404).send({ error: "Recording not found" });
      }

      return {
        id: job.id,
        status: job.status,
        transcription: job.transcription,
        agent_notes: job.agentNotes,
        error: job.error,
      };
    });

    // Ramble: delete a recording
    app.delete<{ Params: { id: string } }>("/ramble/recordings/:id", async (request, reply) => {
      const { id } = request.params;
      deleteJob(id);
      deleteRecordingAudio(id);
      return reply.status(204).send();
    });
  });

  return server;
}
