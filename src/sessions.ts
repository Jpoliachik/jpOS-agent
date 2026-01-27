/**
 * Simple in-memory session store with TTL
 * Maps external identifiers (telegram user id, api client id) to agent session IDs
 * Sessions expire after 1 hour of inactivity
 */

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // Run cleanup every 10 minutes

interface Session {
  agentSessionId: string;
  createdAt: Date;
  lastUsedAt: Date;
}

const sessions = new Map<string, Session>();

function isExpired(session: Session): boolean {
  return Date.now() - session.lastUsedAt.getTime() > SESSION_TTL_MS;
}

function cleanupExpiredSessions(): void {
  for (const [id, session] of sessions) {
    if (isExpired(session)) {
      console.log(`Session expired: ${id}`);
      sessions.delete(id);
    }
  }
}

// Periodic cleanup
setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL_MS);

export function getSession(externalId: string): Session | undefined {
  const session = sessions.get(externalId);
  if (!session) return undefined;

  if (isExpired(session)) {
    sessions.delete(externalId);
    return undefined;
  }

  return session;
}

export function setSession(externalId: string, agentSessionId: string): void {
  const existing = sessions.get(externalId);
  if (existing) {
    existing.agentSessionId = agentSessionId;
    existing.lastUsedAt = new Date();
  } else {
    sessions.set(externalId, {
      agentSessionId,
      createdAt: new Date(),
      lastUsedAt: new Date(),
    });
  }
}

export function clearSession(externalId: string): void {
  sessions.delete(externalId);
}

export function touchSession(externalId: string): void {
  const session = sessions.get(externalId);
  if (session) {
    session.lastUsedAt = new Date();
  }
}
