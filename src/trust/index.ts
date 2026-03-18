// Audit log
export { FileAuditLog } from './audit/index.js';
export type { AuditLog, AuditEvent, AuditEventInput, AuditFilter } from './audit/index.js';

// Credential vault
export { EncryptedVault } from './vault/index.js';
export { SecretProxy } from './vault/index.js';
export { createSecretTools } from './vault/index.js';
export { runSecretCommand } from './vault/index.js';
export type { SecretVault } from './vault/index.js';

// PII redactor
export { DefaultPiiRedactor } from './pii/index.js';
export { balanceToRange, hashAccountId } from './pii/index.js';
export type { PiiRedactor, RedactionRule } from './pii/index.js';

// Approval gate
export { ApprovalGate } from './approval/index.js';
export { DEFAULT_APPROVAL_CONFIG } from './approval/index.js';
export type { ApprovalGateConfig, ApprovalResult, ApprovalRequest } from './approval/index.js';

// Guarded tool registry
export { GuardedToolRegistry } from './guarded-tool-registry.js';
export type { GuardedToolRegistryOptions } from './guarded-tool-registry.js';
export type { ToolCallContext, ToolExecutor } from '../core/types.js';

// Configuration
export { TrustConfigSchema } from './config.js';
export type { TrustConfig } from './config.js';
