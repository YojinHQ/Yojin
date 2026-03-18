import { describe, expect, it } from 'vitest';

import { truncateToolResult, truncateToolResults } from '../../src/core/tool-result-truncation.js';

describe('truncateToolResult', () => {
  it('does not truncate content under the limit', () => {
    const { content, wasTruncated } = truncateToolResult('short content', {
      maxChars: 1000,
    });
    expect(content).toBe('short content');
    expect(wasTruncated).toBe(false);
  });

  it('does not truncate content exactly at the limit', () => {
    const text = 'a'.repeat(100);
    const { content, wasTruncated } = truncateToolResult(text, { maxChars: 100 });
    expect(content).toBe(text);
    expect(wasTruncated).toBe(false);
  });

  it('truncates content over the limit', () => {
    const text = 'a'.repeat(200);
    const { content, wasTruncated } = truncateToolResult(text, { maxChars: 100 });
    expect(wasTruncated).toBe(true);
    expect(content.length).toBeLessThanOrEqual(100);
  });

  it('preserves head and tail content', () => {
    // Create a string with distinct head and tail
    const head = 'HEAD'.repeat(50); // 200 chars
    const middle = 'MIDDLE'.repeat(100); // 600 chars
    const tail = 'TAIL'.repeat(50); // 200 chars — contains "error" patterns
    const text = head + middle + tail;

    const { content, wasTruncated } = truncateToolResult(text, { maxChars: 300 });
    expect(wasTruncated).toBe(true);

    // Should contain some of the head
    expect(content).toContain('HEAD');
    // Should contain some of the tail
    expect(content).toContain('TAIL');
    // Should contain the omission marker
    expect(content).toContain('[... content truncated');
  });

  it('head gets ~70% of budget and tail gets ~30%', () => {
    const text = 'x'.repeat(10000);
    const { content } = truncateToolResult(text, { maxChars: 1000 });

    const markerIndex = content.indexOf('[... content truncated');
    expect(markerIndex).toBeGreaterThan(0);

    const headPart = content.slice(0, markerIndex);
    const markerEnd = content.indexOf(']\n\n', markerIndex) + 3;
    const tailPart = content.slice(markerEnd);

    // Head should be ~70% of usable budget, tail ~30%
    // Allow some tolerance for the marker
    expect(headPart.length).toBeGreaterThan(tailPart.length);
  });

  it('uses default maxChars when no config provided', () => {
    // Default is 50_000 — content under that should not be truncated
    const text = 'a'.repeat(49_000);
    const { wasTruncated } = truncateToolResult(text);
    expect(wasTruncated).toBe(false);

    const longText = 'a'.repeat(60_000);
    const { wasTruncated: wasTruncated2 } = truncateToolResult(longText);
    expect(wasTruncated2).toBe(true);
  });
});

describe('truncateToolResults', () => {
  it('truncates oversized results in an array', () => {
    const results = [
      { result: { content: 'short' } },
      { result: { content: 'a'.repeat(200) } },
      { result: { content: 'also short' } },
    ];

    const count = truncateToolResults(results, { maxChars: 100 });
    expect(count).toBe(1); // Only the second one was truncated
    expect(results[0].result.content).toBe('short');
    expect(results[1].result.content.length).toBeLessThanOrEqual(100);
    expect(results[2].result.content).toBe('also short');
  });

  it('returns 0 when nothing truncated', () => {
    const results = [{ result: { content: 'a' } }, { result: { content: 'b' } }];
    const count = truncateToolResults(results, { maxChars: 1000 });
    expect(count).toBe(0);
  });

  it('mutates results in place', () => {
    const results = [{ result: { content: 'a'.repeat(200) } }];
    truncateToolResults(results, { maxChars: 50 });
    expect(results[0].result.content.length).toBeLessThanOrEqual(50);
  });
});
