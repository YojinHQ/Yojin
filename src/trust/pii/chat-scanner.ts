/**
 * ChatPiiScanner — detects and masks PII in free-text chat messages
 * before they reach the LLM provider.
 *
 * Wraps Rehydra for regex-based detection (email, phone, IBAN, credit card,
 * IP, URL) with optional NER for names/orgs/locations.
 *
 * Flow:
 *   1. User types message with PII
 *   2. scrub() masks PII → returns sanitized text + encrypted map
 *   3. LLM processes sanitized text
 *   4. restore() rehydrates PII tags in LLM response
 */

import {
  type AnonymizationResult,
  type Anonymizer,
  type AnonymizerConfig,
  type EncryptedPIIMap,
  InMemoryKeyProvider,
  createAnonymizer,
  decryptPIIMap,
  generateKey,
  rehydrate,
} from 'rehydra';

import type { AuditLog } from '../audit/types.js';

export interface ChatPiiScannerOptions {
  auditLog: AuditLog;
  /** Enable NER model for name/org/location detection. Default: false (regex-only). */
  enableNer?: boolean;
  /** NER model mode when enabled. Default: 'quantized' (~280MB). */
  nerMode?: 'quantized' | 'standard';
}

export interface ScrubResult {
  /** Sanitized text with PII replaced by tags. */
  sanitized: string;
  /** Encrypted PII map for rehydration. Undefined if no PII found. */
  piiMap?: EncryptedPIIMap;
  /** Number of PII entities detected. */
  entitiesFound: number;
  /** Types of PII detected (e.g. ['EMAIL', 'PHONE']). */
  typesFound: string[];
  /** Processing time in ms. */
  processingTimeMs: number;
}

export class ChatPiiScanner {
  private anonymizer: Anonymizer;
  private readonly auditLog: AuditLog;
  private readonly encryptionKey: Uint8Array;
  private initialized = false;

  constructor(options: ChatPiiScannerOptions) {
    this.auditLog = options.auditLog;
    this.encryptionKey = generateKey();

    const keyProvider = new InMemoryKeyProvider(this.encryptionKey);

    const config: AnonymizerConfig = {
      mode: 'pseudonymize',
      keyProvider,
      ner: options.enableNer ? { mode: options.nerMode ?? 'quantized' } : { mode: 'disabled' },
    };

    this.anonymizer = createAnonymizer(config);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.anonymizer.initialize();
    this.initialized = true;
  }

  /**
   * Scan and mask PII in a user message before it reaches the LLM.
   */
  async scrub(message: string): Promise<ScrubResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const result: AnonymizationResult = await this.anonymizer.anonymize(message);

    // No PII found — return original text
    if (result.stats.totalEntities === 0) {
      return {
        sanitized: message,
        entitiesFound: 0,
        typesFound: [],
        processingTimeMs: result.stats.processingTimeMs,
      };
    }

    const typesFound = Object.entries(result.stats.countsByType)
      .filter(([, count]) => count > 0)
      .map(([type]) => type);

    this.auditLog.append({
      type: 'pii.redact',
      details: {
        fieldsRedacted: result.stats.totalEntities,
        rulesApplied: typesFound,
      },
    });

    return {
      sanitized: result.anonymizedText,
      piiMap: result.piiMap,
      entitiesFound: result.stats.totalEntities,
      typesFound,
      processingTimeMs: result.stats.processingTimeMs,
    };
  }

  /**
   * Restore PII tags in LLM response text using the encrypted map from scrub().
   */
  async restore(response: string, piiMap: EncryptedPIIMap): Promise<string> {
    const rawMap = await decryptPIIMap(piiMap, this.encryptionKey);
    return rehydrate(response, rawMap);
  }

  async dispose(): Promise<void> {
    await this.anonymizer.dispose();
  }
}
