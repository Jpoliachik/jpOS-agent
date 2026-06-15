import { z } from "zod";

/**
 * Contacts — the digital Rolodex. Source of truth for "who do I know and when
 * did I last reach out", which is the queryable backbone behind "who am I
 * overdue to contact". Rich/fuzzy detail lives in `notes`; arbitrary extra
 * fields can go in `metadata` without a migration.
 */
export const CONTACT_TIERS = ["inner", "close", "keep-warm", "periphery"] as const;

export const ContactInput = z.object({
  /** Omit to create; pass an existing id to update that contact. */
  id: z.string().optional(),
  /** Required when creating. On update, only provided fields are changed. */
  name: z.string().min(1).optional(),
  /** How you know them, e.g. "college roommate", "ex-coworker at IR". */
  relationship: z.string().optional(),
  tier: z.enum(CONTACT_TIERS).optional(),
  /** Target days between touches. Null/omitted = no cadence goal. */
  cadence_days: z.number().int().positive().optional(),
  /** ISO date (YYYY-MM-DD or full ISO) of the last time you connected. */
  last_contacted: z.string().optional(),
  location: z.string().optional(),
  /** ISO date or MM-DD. */
  birthday: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  /** Freeform context — what you talked about, kids' names, etc. */
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
  /** Escape hatch for arbitrary structured fields without a migration. */
  metadata: z.record(z.unknown()).optional(),
});
export type ContactInput = z.infer<typeof ContactInput>;

/** A single logged touchpoint with a contact. */
export const InteractionInput = z.object({
  contact_id: z.string().min(1, "contact_id is required"),
  /** ISO datetime; defaults to now if omitted. */
  occurred_at: z.string().optional(),
  /** call, text, in-person, email, dm, etc. */
  channel: z.string().optional(),
  notes: z.string().optional(),
});
export type InteractionInput = z.infer<typeof InteractionInput>;
