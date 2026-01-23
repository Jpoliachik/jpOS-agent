/**
 * Simple in-memory session store
 * Maps external identifiers (telegram user id, api client id) to agent session IDs
 */

interface Session {
  agentSessionId: string;
  createdAt: Date;
  lastUsedAt: Date;
}

const sessions = new Map<string, Session>();

export function getSession(externalId: string): Session | undefined {
  return sessions.get(externalId);
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
