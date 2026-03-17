/**
 * SecretProxy — makes authenticated HTTP requests without ever exposing
 * raw credential values to callers (and therefore to the LLM context).
 *
 * SECURITY INVARIANT: No method on this class returns a raw secret value.
 * Credentials are injected into outbound requests internally. The caller
 * receives only the HTTP response body — never the headers, auth tokens,
 * or any material that could leak into an LLM prompt.
 *
 */

import type { SecretVault } from './types.js';
import type { AuditEventInput, AuditLog } from '../audit/types.js';

// Re-export DLP patterns so the proxy can scrub responses
const CREDENTIAL_PATTERNS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/,
  /sk-ant-api\d{2}-[\w-]{20,}/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{32,}/,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/,
  /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /\bghp_[A-Za-z0-9]{36}\b/,
  /\bghs_[A-Za-z0-9]{36}\b/,
  /xox[bpras]-[\w-]{10,}/,
];

export interface ProxyRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Header name to inject the credential into (default: 'Authorization'). */
  headerName?: string;
  /** Prefix for the credential value (default: 'Bearer '). */
  prefix?: string;
  /** Request timeout in ms (default: 30000). */
  timeout?: number;
}

export interface ProxyResponse {
  status: number;
  /** Response body as text. Scrubbed of any detected credential patterns. */
  body: string;
  /** Whether the response body was scrubbed (a credential pattern was detected and removed). */
  scrubbed: boolean;
}

export class SecretProxy {
  private readonly vault: SecretVault;
  private readonly auditLog: AuditLog;
  /** Optional fetch implementation for testing (defaults to global fetch). */
  private readonly fetchFn: typeof fetch;

  constructor(vault: SecretVault, auditLog: AuditLog, fetchFn?: typeof fetch) {
    this.vault = vault;
    this.auditLog = auditLog;
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Make an authenticated HTTP request. The credential identified by `key`
   * is injected into the request headers but NEVER returned to the caller.
   *
   * Returns the response body only — scrubbed of:
   * 1. The exact credential value used in this request
   * 2. Any known credential patterns (AWS keys, JWTs, etc.)
   */
  async authenticatedFetch(key: string, url: string, options: ProxyRequestOptions = {}): Promise<ProxyResponse> {
    const {
      method = 'GET',
      headers = {},
      body,
      headerName = 'Authorization',
      prefix = 'Bearer ',
      timeout = 30_000,
    } = options;

    // Retrieve the credential — this value NEVER leaves this method
    const credential = await this.vault.get(key);

    // Build request headers with credential injected
    const requestHeaders: Record<string, string> = {
      ...headers,
      [headerName]: `${prefix}${credential}`,
    };

    // Log the authenticated request (without the credential value)
    this.auditLog.append({
      type: 'secret.access',
      details: {
        key,
        action: 'proxy_fetch',
        url,
        method,
      },
    } as AuditEventInput);

    // Make the request with a timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await this.fetchFn(url, {
        method,
        headers: requestHeaders,
        body,
        signal: controller.signal,
      });

      const responseBody = await response.text();

      // Scrub the response body — first the exact credential, then known patterns
      const { text: scrubbedBody, scrubbed } = this.scrubCredentials(responseBody, credential);

      return {
        status: response.status,
        body: scrubbedBody,
        scrubbed,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check if a credential exists in the vault (name only, no value).
   */
  async hasCredential(key: string): Promise<boolean> {
    return this.vault.has(key);
  }

  /**
   * List available credential names (never values).
   */
  async listCredentials(): Promise<string[]> {
    return this.vault.list();
  }

  /**
   * Scrub credential values from text. Two layers:
   * 1. Exact match of the credential used in this request
   * 2. Known credential patterns (AWS keys, JWTs, GitHub tokens, etc.)
   */
  private scrubCredentials(text: string, credential?: string): { text: string; scrubbed: boolean } {
    let scrubbed = false;
    let result = text;

    // Layer 1: scrub the exact credential value (if 4+ chars to avoid false positives)
    if (credential && credential.length >= 4 && result.includes(credential)) {
      result = result.split(credential).join('[REDACTED]');
      scrubbed = true;
    }

    // Layer 2: scrub known credential patterns
    for (const pattern of CREDENTIAL_PATTERNS) {
      const globalPattern = new RegExp(pattern.source, 'g');
      const replaced = result.replace(globalPattern, '[REDACTED]');
      if (replaced !== result) {
        scrubbed = true;
        result = replaced;
      }
    }

    return { text: result, scrubbed };
  }
}
