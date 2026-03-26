/**
 * E2E test — Signal Assessment workflow.
 *
 * Validates the full pipeline:
 *   beforeWorkflow (pre-aggregate curated signals + thesis context)
 *   → Research Analyst (classify CRITICAL/IMPORTANT/NOISE)
 *   → Strategist (score + save_signal_assessment tool call)
 *   → afterWorkflow (update watermark)
 *
 * Seeds a portfolio snapshot, curated signals, and an insight report in a
 * temp directory, then runs the workflow with a mock LLM provider.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Orchestrator } from '../src/agents/orchestrator.js';
import { AgentRegistry } from '../src/agents/registry.js';
import type { AgentProfile } from '../src/agents/types.js';
import { AgentRuntime } from '../src/core/agent-runtime.js';
import { EventLog } from '../src/core/event-log.js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import type { AgentLoopProvider, ContentBlock } from '../src/core/types.js';
import { GuardRunner } from '../src/guards/guard-runner.js';
import { InsightStore } from '../src/insights/insight-store.js';
import { PortfolioSnapshotStore } from '../src/portfolio/snapshot-store.js';
import { InMemorySessionStore } from '../src/sessions/memory-store.js';
import { AssessmentStore } from '../src/signals/curation/assessment-store.js';
import { createAssessmentTools } from '../src/signals/curation/assessment-tools.js';
import { registerSignalAssessmentWorkflow } from '../src/signals/curation/assessment-workflow.js';
import { CuratedSignalStore } from '../src/signals/curation/curated-signal-store.js';
import type { CuratedSignal } from '../src/signals/curation/types.js';
import type { Signal } from '../src/signals/types.js';
import { FileAuditLog } from '../src/trust/audit/audit-log.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StubRole = 'analyst' | 'strategist' | 'risk-manager' | 'trader';
const ROLE_MAP: Record<string, StubRole> = {
  'research-analyst': 'analyst',
  strategist: 'strategist',
  'risk-manager': 'risk-manager',
  trader: 'trader',
};

function stubProfile(id: string, tools: string[] = []): AgentProfile {
  return {
    id,
    name: id,
    role: ROLE_MAP[id] ?? 'analyst',
    description: `${id} agent`,
    tools,
    allowedActions: ['tool_call'],
    capabilities: ['testing'],
  };
}

const NOW = new Date();

function makeSignal(id: string, ticker: string, title: string, sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): Signal {
  return {
    id,
    contentHash: `hash-${id}`,
    type: 'NEWS',
    title,
    assets: [{ ticker, relevance: 0.9, linkType: 'DIRECT' }],
    sources: [{ id: 'test-source', name: 'Test', type: 'API', reliability: 0.9 }],
    publishedAt: new Date(NOW.getTime() - 2 * 3600_000).toISOString(),
    ingestedAt: new Date(NOW.getTime() - 1 * 3600_000).toISOString(),
    confidence: 0.85,
    sentiment,
    outputType: 'INSIGHT',
    version: 1,
  };
}

function makeCuratedSignal(signal: Signal, ticker: string, score: number): CuratedSignal {
  return {
    signal,
    scores: [
      {
        signalId: signal.id,
        ticker,
        exposureWeight: 0.15,
        typeRelevance: 0.8,
        compositeScore: score,
      },
    ],
    curatedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(), // 30 min ago
  };
}

// The assessment payload the Strategist tool call will include
const ASSESSMENT_TOOL_INPUT = {
  assessments: [
    {
      signalId: 'sig-001',
      ticker: 'AAPL',
      verdict: 'CRITICAL',
      relevanceScore: 0.92,
      reasoning: 'Earnings beat directly supports growth thesis.',
      thesisAlignment: 'SUPPORTS',
      actionability: 0.85,
    },
    {
      signalId: 'sig-002',
      ticker: 'AAPL',
      verdict: 'IMPORTANT',
      relevanceScore: 0.71,
      reasoning: 'AI partnership validates long-term AI integration thesis.',
      thesisAlignment: 'SUPPORTS',
      actionability: 0.6,
    },
    {
      signalId: 'sig-003',
      ticker: 'AAPL',
      verdict: 'NOISE',
      relevanceScore: 0.2,
      reasoning: 'Generic roundup article, no new information.',
      thesisAlignment: 'NEUTRAL',
      actionability: 0.1,
    },
    {
      signalId: 'sig-004',
      ticker: 'BTC',
      verdict: 'CRITICAL',
      relevanceScore: 0.88,
      reasoning: 'ETF inflows signal is a major institutional catalyst.',
      thesisAlignment: 'SUPPORTS',
      actionability: 0.9,
    },
    {
      signalId: 'sig-005',
      ticker: 'BTC',
      verdict: 'NOISE',
      relevanceScore: 0.15,
      reasoning: 'Stale sentiment data, already reflected in thesis.',
      thesisAlignment: 'NEUTRAL',
      actionability: 0.05,
    },
  ],
  thesisSummary:
    'Overweight tech on strong earnings. BTC held for institutional adoption catalyst. Monitoring macro risks.',
};

/**
 * Mock provider — scripted responses for Research Analyst and Strategist.
 * RA: text-only classification. Strategist: tool call then final text.
 */
function createAssessmentMockProvider(): AgentLoopProvider {
  let strategistCalls = 0;

  return {
    completeWithTools: vi.fn(async (params) => {
      const system = (params.system ?? '') as string;
      const sysLower = system.toLowerCase();

      const isStrategist = sysLower.includes('# strategist');

      if (isStrategist) {
        strategistCalls++;
        // First call: invoke save_signal_assessment tool
        if (strategistCalls === 1) {
          return {
            content: [
              { type: 'text' as const, text: 'Scoring signals against active thesis...' },
              {
                type: 'tool_use' as const,
                id: `tool-call-strategist-${strategistCalls}`,
                name: 'save_signal_assessment',
                input: ASSESSMENT_TOOL_INPUT,
              },
            ] as ContentBlock[],
            stopReason: 'tool_use',
            usage: { inputTokens: 400, outputTokens: 150 },
          };
        }
        // After tool result, final response
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'Assessment complete. 3 CRITICAL/IMPORTANT signals kept out of 5 evaluated. ' +
                'AAPL earnings beat is the top signal; BTC ETF inflows also critical.',
            },
          ] as ContentBlock[],
          stopReason: 'end_turn',
          usage: { inputTokens: 200, outputTokens: 80 },
        };
      }

      // Research Analyst — classify signals
      return {
        content: [
          {
            type: 'text' as const,
            text:
              '## AAPL\n' +
              '- [sig-001] CRITICAL: Earnings beat is a direct thesis catalyst\n' +
              '- [sig-002] IMPORTANT: AI partnership supports long-term narrative\n' +
              '- [sig-003] NOISE: Generic roundup, no new info\n\n' +
              '## BTC\n' +
              '- [sig-004] CRITICAL: ETF inflows are a major institutional signal\n' +
              '- [sig-005] NOISE: Stale sentiment already priced in',
          },
        ] as ContentBlock[],
        stopReason: 'end_turn',
        usage: { inputTokens: 300, outputTokens: 120 },
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('E2E Signal Assessment workflow', () => {
  let tempDir: string;
  let assessmentStore: AssessmentStore;
  let curatedSignalStore: CuratedSignalStore;
  let insightStore: InsightStore;
  let snapshotStore: PortfolioSnapshotStore;
  let orchestrator: Orchestrator;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-assessment-e2e-'));

    assessmentStore = new AssessmentStore(tempDir);
    curatedSignalStore = new CuratedSignalStore(tempDir);
    insightStore = new InsightStore(tempDir);
    snapshotStore = new PortfolioSnapshotStore(tempDir);

    // Seed portfolio snapshot (AAPL + BTC)
    await snapshotStore.save({
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          quantity: 50,
          currentPrice: 180,
          marketValue: 9000,
          costBasis: 7500,
          unrealizedPnl: 1500,
          unrealizedPnlPercent: 20,
          assetClass: 'EQUITY',
          platform: 'MANUAL',
        },
        {
          symbol: 'BTC',
          name: 'Bitcoin',
          quantity: 0.5,
          currentPrice: 60000,
          marketValue: 30000,
          costBasis: 25000,
          unrealizedPnl: 5000,
          unrealizedPnlPercent: 20,
          assetClass: 'CRYPTO',
          platform: 'MANUAL',
        },
      ],
      platform: 'MANUAL',
    });

    // Seed curated signals
    const sig1 = makeSignal('sig-001', 'AAPL', 'Q4 earnings beat estimates by 8%', 'BULLISH');
    const sig2 = makeSignal('sig-002', 'AAPL', 'Apple AI partnership with OpenAI', 'BULLISH');
    const sig3 = makeSignal('sig-003', 'AAPL', 'Weekly tech roundup: Apple, Google, Meta', 'NEUTRAL');
    const sig4 = makeSignal('sig-004', 'BTC', 'Bitcoin ETF sees record $1B inflows', 'BULLISH');
    const sig5 = makeSignal('sig-005', 'BTC', 'Retail sentiment mixed on crypto', 'BEARISH');

    await curatedSignalStore.writeBatch([
      makeCuratedSignal(sig1, 'AAPL', 0.82),
      makeCuratedSignal(sig2, 'AAPL', 0.75),
      makeCuratedSignal(sig3, 'AAPL', 0.45),
      makeCuratedSignal(sig4, 'BTC', 0.88),
      makeCuratedSignal(sig5, 'BTC', 0.4),
    ]);

    // Seed an insight report (provides thesis context)
    await insightStore.save({
      id: 'insight-test',
      snapshotId: 'snap-test',
      createdAt: new Date().toISOString(),
      positions: [
        {
          symbol: 'AAPL',
          name: 'Apple Inc.',
          rating: 'BUY',
          conviction: 0.8,
          thesis: 'Strong earnings momentum and AI integration driving growth.',
          keySignals: [],
          risks: ['Regulatory pressure'],
          opportunities: ['AI product line'],
          memoryContext: null,
          priceTarget: 210,
        },
        {
          symbol: 'BTC',
          name: 'Bitcoin',
          rating: 'HOLD',
          conviction: 0.5,
          thesis: 'Waiting for institutional catalyst. ETF flows are key signal.',
          keySignals: [],
          risks: ['Fed hawkish pivot'],
          opportunities: ['ETF approval momentum'],
          memoryContext: null,
          priceTarget: null,
        },
      ],
      portfolio: {
        overallHealth: 'HEALTHY',
        summary: 'Balanced allocation with growth tilt.',
        sectorThemes: ['Tech', 'Crypto'],
        macroContext: 'Soft landing expected.',
        topRisks: ['Concentration risk'],
        topOpportunities: ['AI expansion'],
        actionItems: [],
      },
      agentOutputs: {
        researchAnalyst: 'AAPL strong fundamentals. BTC institutional inflows.',
        riskManager: 'Moderate concentration risk in tech.',
        strategist: 'Maintain positions, watch macro.',
      },
      emotionState: {
        confidence: 0.7,
        riskAppetite: 0.6,
        reason: 'Positive momentum with moderate caution.',
      },
      durationMs: 1000,
    });

    // Build runtime
    const auditLog = new FileAuditLog(tempDir);
    const toolRegistry = new ToolRegistry();

    for (const tool of createAssessmentTools({ assessmentStore })) {
      toolRegistry.register(tool);
    }

    const agentRegistry = new AgentRegistry();
    agentRegistry.register(stubProfile('research-analyst'));
    agentRegistry.register(stubProfile('strategist', ['save_signal_assessment']));
    agentRegistry.register(stubProfile('risk-manager'));
    agentRegistry.register(stubProfile('trader'));
    agentRegistry.register(stubProfile('bull-researcher'));
    agentRegistry.register(stubProfile('bear-researcher'));

    const runtime = new AgentRuntime({
      agentRegistry,
      toolRegistry,
      guardRunner: new GuardRunner([{ name: 'pass', check: () => ({ pass: true }) }], { auditLog }),
      sessionStore: new InMemorySessionStore(),
      eventLog: new EventLog(tempDir),
      provider: createAssessmentMockProvider(),
    });

    orchestrator = new Orchestrator(runtime);
    registerSignalAssessmentWorkflow(orchestrator, {
      curatedSignalStore,
      assessmentStore,
      insightStore,
      snapshotStore,
      config: { intervalMinutes: 60, maxSignalsPerPosition: 5 },
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('executes the full signal-assessment workflow', async () => {
    const results = await orchestrator.execute('signal-assessment', {});

    // Both agents should have produced output
    expect(results.has('research-analyst')).toBe(true);
    expect(results.has('strategist')).toBe(true);
  });

  it('Research Analyst classifies signals in 1 iteration', async () => {
    const results = await orchestrator.execute('signal-assessment', {});

    const ra = results.get('research-analyst');
    expect(ra).toBeDefined();
    expect(ra!.iterations).toBe(1);
    expect(ra!.text).toContain('CRITICAL');
    expect(ra!.text).toContain('NOISE');
    expect(ra!.text).toContain('sig-001');
  });

  it('Strategist calls save_signal_assessment and gets tool result', async () => {
    const results = await orchestrator.execute('signal-assessment', {});

    const strategist = results.get('strategist');
    expect(strategist).toBeDefined();
    // maxIterations: 1 in workflow — tool call + result fit in a single iteration
    expect(strategist!.iterations).toBe(1);
    // Text is the LLM's text output from the tool-use response
    expect(strategist!.text).toContain('Scoring signals against active thesis');
  });

  it('persists an AssessmentReport to the store', async () => {
    // Before: no reports
    const before = await assessmentStore.getLatest();
    expect(before).toBeNull();

    await orchestrator.execute('signal-assessment', {});

    // After: report should be persisted
    const report = await assessmentStore.getLatest();
    expect(report).not.toBeNull();
    expect(report!.assessments).toHaveLength(5);
    expect(report!.tickers.sort()).toEqual(['AAPL', 'BTC']);
    expect(report!.signalsInput).toBe(5);
    expect(report!.signalsKept).toBe(3); // 2 CRITICAL + 1 IMPORTANT
    expect(report!.thesisSummary).toContain('Overweight tech');
  });

  it('assessment verdicts are correct', async () => {
    await orchestrator.execute('signal-assessment', {});

    const report = await assessmentStore.getLatest();
    expect(report).not.toBeNull();

    const byId = new Map(report!.assessments.map((a) => [a.signalId, a]));

    // AAPL
    expect(byId.get('sig-001')!.verdict).toBe('CRITICAL');
    expect(byId.get('sig-001')!.thesisAlignment).toBe('SUPPORTS');
    expect(byId.get('sig-002')!.verdict).toBe('IMPORTANT');
    expect(byId.get('sig-003')!.verdict).toBe('NOISE');

    // BTC
    expect(byId.get('sig-004')!.verdict).toBe('CRITICAL');
    expect(byId.get('sig-005')!.verdict).toBe('NOISE');
  });

  it('updates the assessment watermark after workflow', async () => {
    // Before: no watermark
    const wmBefore = await assessmentStore.getLatestWatermark();
    expect(wmBefore).toBeNull();

    await orchestrator.execute('signal-assessment', {});

    const wm = await assessmentStore.getLatestWatermark();
    expect(wm).not.toBeNull();
    expect(wm!.signalsAssessed).toBe(5);
    expect(wm!.signalsKept).toBe(3);
    expect(new Date(wm!.lastRunAt).getTime()).not.toBeNaN();
    expect(new Date(wm!.lastCuratedAt).getTime()).not.toBeNaN();
  });

  it('skips assessment when no new curated signals since watermark', async () => {
    // Run once to set watermark
    await orchestrator.execute('signal-assessment', {});

    // Run again — watermark should make it skip (no new signals after lastCuratedAt)
    const results2 = await orchestrator.execute('signal-assessment', {});

    // RA still runs but with empty signal data (beforeWorkflow sets empty text)
    const ra2 = results2.get('research-analyst');
    expect(ra2).toBeDefined();

    // No NEW assessment report should be created (only the first one)
    const reports = await assessmentStore.queryByTickers(['AAPL', 'BTC']);
    expect(reports).toHaveLength(1);
  });

  it('pre-aggregated signal data includes thesis context from InsightReport', async () => {
    const provider = createAssessmentMockProvider();

    // Rebuild with this provider so we can inspect calls
    const auditLog = new FileAuditLog(tempDir);
    const toolRegistry = new ToolRegistry();
    for (const tool of createAssessmentTools({ assessmentStore })) {
      toolRegistry.register(tool);
    }

    const agentRegistry = new AgentRegistry();
    agentRegistry.register(stubProfile('research-analyst'));
    agentRegistry.register(stubProfile('strategist', ['save_signal_assessment']));
    agentRegistry.register(stubProfile('risk-manager'));
    agentRegistry.register(stubProfile('trader'));
    agentRegistry.register(stubProfile('bull-researcher'));
    agentRegistry.register(stubProfile('bear-researcher'));

    // Clear watermark so it processes
    const freshAssessmentStore = new AssessmentStore(tempDir + '-fresh');

    const runtime = new AgentRuntime({
      agentRegistry,
      toolRegistry,
      guardRunner: new GuardRunner([{ name: 'pass', check: () => ({ pass: true }) }], { auditLog }),
      sessionStore: new InMemorySessionStore(),
      eventLog: new EventLog(tempDir),
      provider,
    });

    const orch = new Orchestrator(runtime);
    registerSignalAssessmentWorkflow(orch, {
      curatedSignalStore,
      assessmentStore: freshAssessmentStore,
      insightStore,
      snapshotStore,
      config: { intervalMinutes: 60, maxSignalsPerPosition: 5 },
    });

    await orch.execute('signal-assessment', {});

    // The RA's message (first LLM call) should contain formatted signal data with thesis
    const calls = (provider.completeWithTools as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);

    // First call is RA — check message contains thesis and signal data
    const raCall = calls[0][0];
    const raMessages = raCall.messages as Array<{ role: string; content: string }>;
    const raMessage = raMessages.find((m: { role: string }) => m.role === 'user')?.content ?? '';

    expect(raMessage).toContain('AAPL');
    expect(raMessage).toContain('BTC');
    expect(raMessage).toContain('sig-001');
    expect(raMessage).toContain('CRITICAL');
  });

  it('AssessmentReport schema validates correctly', async () => {
    await orchestrator.execute('signal-assessment', {});

    const report = await assessmentStore.getLatest();
    expect(report).not.toBeNull();

    // Verify all required fields are present
    expect(typeof report!.id).toBe('string');
    expect(report!.id.length).toBeGreaterThan(0);
    expect(new Date(report!.assessedAt).getTime()).not.toBeNaN();
    expect(report!.tickers.length).toBeGreaterThan(0);
    expect(report!.durationMs).toBeGreaterThanOrEqual(0);

    for (const a of report!.assessments) {
      expect(['CRITICAL', 'IMPORTANT', 'NOISE']).toContain(a.verdict);
      expect(a.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(a.relevanceScore).toBeLessThanOrEqual(1);
      expect(a.reasoning.length).toBeGreaterThan(0);
      expect(['SUPPORTS', 'CHALLENGES', 'NEUTRAL']).toContain(a.thesisAlignment);
      expect(a.actionability).toBeGreaterThanOrEqual(0);
      expect(a.actionability).toBeLessThanOrEqual(1);
    }
  });
});
