/**
 * Provider credential error detection and invalidation hook.
 *
 * Decouples the agent-loop (src/core) from the vault/config layer
 * (src/api/graphql/resolvers) by letting the composition root register a
 * cleanup handler that the agent loop fires when it detects an auth error.
 *
 * Registration (composition root / ai-config resolver):
 *   registerCredentialErrorHandler(clearDefaultProviderCredential);
 *
 * Detection + dispatch (agent-loop):
 *   if (isProviderCredentialError(err)) void handleProviderCredentialError();
 */

import { createSubsystemLogger } from '../logging/logger.js';

const logger = createSubsystemLogger('credential-error');

/** Handler registered by the composition layer to clean up an invalid credential. */
let credentialErrorHandler: (() => Promise<void>) | undefined;

/**
 * Register the function that should run when a credential error is detected.
 * Called once from the ai-config resolver after the vault is wired up.
 */
export function registerCredentialErrorHandler(handler: () => Promise<void>): void {
  credentialErrorHandler = handler;
}

/**
 * Returns true when the error unambiguously means the stored provider
 * credential is rejected and the user must reconnect.
 *
 * Strict by design — we only want to fire the invalidation hook when we are
 * certain the credential is the problem, because the handler deletes it.
 *
 * Matches:
 *   - HTTP 401 (Anthropic SDK AuthenticationError — credential rejected)
 *   - Anthropic error body `type === 'authentication_error'`
 *   - Documented invalid-API-key messages from the Anthropic/OpenAI SDKs
 *
 * Deliberately does NOT match:
 *   - HTTP 403 — can fire on quota, region, or org-permission issues that
 *     have nothing to do with the stored credential.
 *   - "OAuth token has expired" — recoverable via the provider's internal
 *     refresh path (claude-code.ts:575 refreshOAuthToken). If that refresh
 *     fails, the error bubbles up with `status: 401` anyway, which the
 *     first branch catches.
 */
export function isProviderCredentialError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as Record<string, unknown>;

  // A status code on the error object is authoritative — only 401 counts.
  if (typeof e.status === 'number') {
    return e.status === 401;
  }

  // No HTTP status attached — check for an explicit Anthropic error type.
  const errBody = e.error as { type?: unknown } | undefined;
  if (errBody && errBody.type === 'authentication_error') return true;

  // Last resort: string matching on documented SDK error messages.
  const msg = String(e.message ?? err);
  return (
    msg.includes('invalid_api_key') ||
    msg.includes('invalid x-api-key') ||
    msg.includes('Invalid API key') ||
    msg.includes('Incorrect API key') ||
    msg.includes('API key has been revoked')
  );
}

/**
 * Fire the registered credential error handler (best-effort, non-blocking).
 * Safe to call from any layer — logs and swallows handler failures so the
 * original error is never suppressed.
 */
export async function handleProviderCredentialError(): Promise<void> {
  if (!credentialErrorHandler) {
    logger.warn('Provider credential error detected but no handler is registered');
    return;
  }
  try {
    await credentialErrorHandler();
  } catch (handlerErr) {
    logger.error('Credential error handler failed', {
      error: handlerErr instanceof Error ? handlerErr.message : String(handlerErr),
    });
  }
}
