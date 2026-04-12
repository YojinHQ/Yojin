import { describe, expect, it } from 'vitest';

import { SELF_INVALIDATING_RE } from '../../src/signals/quality-patterns.js';

describe('SELF_INVALIDATING_RE', () => {
  const shouldMatch = [
    // Signal admits its own claim is weak
    'lacks independent verification',
    'lacks verification',
    'unverified claim from a Reddit user',
    'the thesis remains speculative without further data',
    'remain speculative given the limited data',
    'relies on anecdotal observation rather than company guidance',
    'rely on anecdotal evidence',
    'no independent confirmation from management',
    'no confirmation from the company',
    'cannot be verified through public filings',
    'cannot be substantiated by available data',
    'cannot be corroborated by official sources',
    'self-reported and unverified metrics',
    'self-reported unverified data',
    'no supporting evidence beyond the original post',
    'no evidence to support the claim',
    "based on a single user's observation of website traffic",
    "based on one person's claim about SEO data",
    // Dead-post markers (P2)
    'the source now shows [deleted]',
    'the Reddit post was [removed] by moderators',
    'source has been removed',
    'source was deleted',
    'post is unavailable',
    'post removed by moderators',
    'source unavailable',
    'no evidence for the claim that revenue doubled',
    'no evidence for this assertion',
  ];

  const shouldNotMatch = [
    // Legitimate financial signals
    'AAPL beats Q3 estimates with $94.9B revenue',
    'FDA approves new drug application for BIIB',
    'analyst upgrades price target to $200',
    'company confirmed the acquisition in an SEC filing',
    'verified by multiple independent sources',
    'quarterly results show 15% revenue growth',
    'Morgan Stanley initiates coverage with Overweight rating',
    // Denial/refutation news — must NOT false-positive (P1)
    'Tesla denied an unverified claim about a production halt',
    'management refuted an unverified claim of insider trading',
    'the board dismissed unverified claims of misconduct',
    'CEO rejected an unverified claim about layoffs',
    'management found no evidence of a data breach',
    'audit revealed no evidence of fraud in Q3 filings',
  ];

  for (const text of shouldMatch) {
    it(`matches: "${text}"`, () => {
      expect(SELF_INVALIDATING_RE.test(text)).toBe(true);
    });
  }

  for (const text of shouldNotMatch) {
    it(`does not match: "${text}"`, () => {
      expect(SELF_INVALIDATING_RE.test(text)).toBe(false);
    });
  }
});
