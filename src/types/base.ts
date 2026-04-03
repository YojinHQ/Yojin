/**
 * Shared Zod base schemas for field and entity reuse across the codebase.
 *
 * Use these building blocks with `.merge()` or `.extend()` in domain types
 * to eliminate copy-pasted field definitions (id, createdAt, confidence, etc.).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Reusable field schemas (use these for individual field reuse)
// ---------------------------------------------------------------------------

/** Standard entity identifier — non-empty string. */
export const IdField = z.string().min(1);

/** Score in [0, 1] range — used for confidence, conviction, relevance, etc. */
export const ScoreRange = z.number().min(0).max(1);

/** ISO 8601 datetime string. */
export const DateTimeField = z.string().datetime();

// ---------------------------------------------------------------------------
// Composable base schemas (use with .merge() or .extend())
// ---------------------------------------------------------------------------

/** Entity with a unique ID. */
export const BaseEntitySchema = z.object({
  id: IdField,
});

/** Adds createdAt timestamp. Merge with BaseEntitySchema for typical entities. */
export const TimestampedSchema = z.object({
  createdAt: DateTimeField,
});

/** Adds optional updatedAt alongside createdAt. */
export const TimestampedWithUpdateSchema = TimestampedSchema.extend({
  updatedAt: DateTimeField.optional(),
});

/** Entity with ID + createdAt. The most common base combination. */
export const TimestampedEntitySchema = BaseEntitySchema.merge(TimestampedSchema);

/** Adds a confidence score field. */
export const ScoredSchema = z.object({
  confidence: ScoreRange,
});
