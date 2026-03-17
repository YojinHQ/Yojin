/**
 * Encrypted vault types and schemas.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Vault file structure
// ---------------------------------------------------------------------------

export const VaultEntrySchema = z.object({
  /** Encrypted value (base64). */
  value: z.string(),
  /** Initialization vector (base64). */
  iv: z.string(),
  /** GCM auth tag (base64). */
  tag: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type VaultEntry = z.infer<typeof VaultEntrySchema>;

export const CanarySchema = z.object({
  /** Encrypted canary value (base64). */
  value: z.string(),
  /** Initialization vector (base64). */
  iv: z.string(),
  /** GCM auth tag (base64). */
  tag: z.string(),
});

export const VaultFileSchema = z.object({
  version: z.literal(1),
  /** PBKDF2 salt (base64). */
  salt: z.string(),
  /** Encrypted entries keyed by secret name. */
  entries: z.record(z.string(), VaultEntrySchema),
  /** Passphrase verification canary — decrypted to validate passphrase on unlock. */
  canary: CanarySchema.optional(),
});
export type VaultFile = z.infer<typeof VaultFileSchema>;

// ---------------------------------------------------------------------------
// Vault interface
// ---------------------------------------------------------------------------

export interface SecretVault {
  /** Store a secret (encrypts the value). */
  set(key: string, value: string): Promise<void>;
  /** Retrieve a decrypted secret. Throws if not found. */
  get(key: string): Promise<string>;
  /** Check if a secret exists. */
  has(key: string): Promise<boolean>;
  /** List secret key names only (never values). */
  list(): Promise<string[]>;
  /** Delete a secret. */
  delete(key: string): Promise<void>;
}
