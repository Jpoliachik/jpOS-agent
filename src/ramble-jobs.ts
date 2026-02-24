/**
 * In-memory job store for Ramble recording processing.
 * Jobs have a 24-hour TTL with hourly cleanup.
 */

const JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface RecordingJob {
  id: string;
  status: "processing" | "completed" | "failed";
  transcription?: string;
  agentNotes?: string;
  error?: string;
  createdAt: Date;
}

const jobs = new Map<string, RecordingJob>();

function cleanupExpiredJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt.getTime() > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

setInterval(cleanupExpiredJobs, CLEANUP_INTERVAL_MS);

export function createJob(id: string): RecordingJob {
  if (jobs.has(id)) {
    throw new Error(`Job already exists: ${id}`);
  }
  const job: RecordingJob = {
    id,
    status: "processing",
    createdAt: new Date(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): RecordingJob | undefined {
  return jobs.get(id);
}

interface CompleteJobParams {
  id: string;
  transcription: string;
  agentNotes: string;
}

export function completeJob(params: CompleteJobParams): void {
  const job = jobs.get(params.id);
  if (!job) return;
  job.status = "completed";
  job.transcription = params.transcription;
  job.agentNotes = params.agentNotes;
}

interface FailJobParams {
  id: string;
  error: string;
}

export function failJob(params: FailJobParams): void {
  const job = jobs.get(params.id);
  if (!job) return;
  job.status = "failed";
  job.error = params.error;
}

export function deleteJob(id: string): boolean {
  return jobs.delete(id);
}
