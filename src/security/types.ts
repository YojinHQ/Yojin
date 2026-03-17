/**
 * Security types — auth, allowlists, and access control.
 */

export interface AllowlistEntry {
  channelId: string;
  userId?: string;
  allowed: boolean;
}

export interface SecurityPolicy {
  /** Whether DMs are enabled for this channel. */
  allowDirectMessages: boolean;
  /** Allowlist for channels/users. Empty = allow all. */
  allowlist: AllowlistEntry[];
}

export interface SecurityAdapter {
  authorize(channelId: string, userId: string): Promise<boolean>;
  getPolicy(): SecurityPolicy;
  updatePolicy(policy: Partial<SecurityPolicy>): void;
}
