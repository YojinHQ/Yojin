/**
 * E2E test — LLM tool output redaction.
 *
 * Verifies that portfolio tools return redacted balance ranges
 * (not exact dollar amounts) to the LLM, while the snapshot store
 * retains exact values for the UI.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ToolDefinition } from '../../src/core/types.js';
import { PortfolioSnapshotStore } from '../../src/portfolio/snapshot-store.js';
import { createPortfolioTools } from '../../src/tools/portfolio-tools.js';

describe('PII Tool Boundary E2E', () => {
  let tmpDir: string;
  let store: PortfolioSnapshotStore;
  let saveTool: ToolDefinition;
  let getTool: ToolDefinition;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'yojin-e2e-pii-'));
    store = new PortfolioSnapshotStore(tmpDir);
    const tools = createPortfolioTools({ snapshotStore: store });
    saveTool = tools.find((t) => t.name === 'save_portfolio_positions')!;
    getTool = tools.find((t) => t.name === 'get_portfolio')!;
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('save tool → LLM sees ranges, snapshot store has exact values', async () => {
    // Save positions with known exact values
    const saveResult = await saveTool.execute({
      platform: 'BINANCE',
      positions: [
        { symbol: 'BTC', name: 'Bitcoin', quantity: 1.5, costBasis: 42000, currentPrice: 67500, marketValue: 101250 },
        { symbol: 'ETH', name: 'Ethereum', quantity: 10, costBasis: 2000, currentPrice: 3500, marketValue: 35000 },
        { symbol: 'DOGE', name: 'Dogecoin', quantity: 50000, costBasis: 0.08, currentPrice: 0.12, marketValue: 6000 },
      ],
    });

    // --- LLM output: REDACTED ---
    const llmOutput = saveResult.content;

    // Should contain balance ranges
    expect(llmOutput).toContain('$100k-$500k'); // totalValue ~$142k
    // Should NOT contain exact dollar amounts
    expect(llmOutput).not.toMatch(/\$101,250/);
    expect(llmOutput).not.toMatch(/\$142,/);
    expect(llmOutput).not.toMatch(/\$35,000/);
    expect(llmOutput).not.toContain('67500');

    // --- Snapshot store: EXACT values for UI ---
    const snapshot = await store.getLatest();
    expect(snapshot).not.toBeNull();
    expect(snapshot!.totalValue).toBeCloseTo(142250, 0);
    expect(snapshot!.positions[0].marketValue).toBe(101250);
    expect(snapshot!.positions[1].marketValue).toBe(35000);
    expect(snapshot!.positions[2].marketValue).toBe(6000);
  });

  it('get_portfolio → LLM sees ranges and percentages only', async () => {
    const getResult = await getTool.execute({});
    const llmOutput = getResult.content;

    // Should show symbols and bucketed quantities (not exact)
    expect(llmOutput).toContain('BTC');
    expect(llmOutput).toContain('ETH');
    expect(llmOutput).toContain('DOGE');
    expect(llmOutput).toContain('1-10 units'); // BTC qty 1.5 → "1-10 units"
    expect(llmOutput).toContain('10-100 units'); // ETH qty 10 → "10-100 units"
    expect(llmOutput).toContain('10k+ units'); // DOGE qty 50000 → "10k+ units"
    // Should NOT contain exact quantities (use word boundary to avoid timestamp false positives)
    expect(llmOutput).not.toMatch(/\b1\.5\b/);
    expect(llmOutput).not.toMatch(/\b50000\b/);

    // Should show percentage P&L (not exact amounts)
    expect(llmOutput).toMatch(/[+-]?\d+\.\d+%/); // e.g. +60.7%

    // Should show total value as range
    expect(llmOutput).toContain('$100k-$500k');

    // Should NOT contain exact dollar values
    expect(llmOutput).not.toMatch(/\$101,250/);
    expect(llmOutput).not.toMatch(/\$35,000/);
    expect(llmOutput).not.toMatch(/\$6,000/);
    expect(llmOutput).not.toMatch(/\$142,/);
    expect(llmOutput).not.toContain('67,500');
    expect(llmOutput).not.toContain('42,000');
  });

  it('position-level values are ranges, not exact numbers', async () => {
    const getResult = await getTool.execute({});
    const llmOutput = getResult.content;

    // Each position should show balance range
    expect(llmOutput).toContain('$100k-$500k'); // BTC $101k → range
    expect(llmOutput).toContain('$10k-$50k'); // ETH $35k → range
    expect(llmOutput).toContain('$1k-$10k'); // DOGE $6k → range
  });
});
