/**
 * E2E test — ProcessInsights workflow.
 *
 * Validates the full pipeline: buildContext → Orchestrator → 3 stages
 * (Research Analyst → Risk Manager → Strategist)
 * → save_insight_report tool execution → InsightStore persistence.
 *
 * Uses a mock provider with scripted responses per agent.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Orchestrator, registerBuiltinWorkflows } from '../src/agents/index.js';
import { AgentRegistry } from '../src/agents/registry.js';
import type { AgentProfile } from '../src/agents/types.js';
import { AgentRuntime } from '../src/core/agent-runtime.js';
import { EventLog } from '../src/core/event-log.js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import type { AgentLoopProvider, ContentBlock } from '../src/core/types.js';
import { GuardRunner } from '../src/guards/guard-runner.js';
import { InsightStore } from '../src/insights/insight-store.js';
import { createInsightTools } from '../src/insights/tools.js';
import { InMemorySessionStore } from '../src/sessions/memory-store.js';
import { FileAuditLog } from '../src/trust/audit/audit-log.js';

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

// A valid insight report payload for the save_insight_report tool
const INSIGHT_REPORT_INPUT = {
  snapshotId: 'snap-test1234',
  positions: [
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      rating: 'BUY',
      conviction: 0.8,
      thesis: 'Strong earnings momentum and expanding services revenue drive continued growth.',
      keySignals: [
        {
          signalId: 'sig-001',
          type: 'FUNDAMENTAL',
          title: 'Q4 earnings beat estimates by 8%',
          impact: 'POSITIVE',
          confidence: 0.9,
        },
      ],
      risks: ['Regulatory pressure in EU market'],
      opportunities: ['AI integration across product line'],
      memoryContext: 'Previous bullish call on AAPL was correct in Q3.',
      priceTarget: 210,
    },
    {
      symbol: 'BTC',
      name: 'Bitcoin',
      rating: 'HOLD',
      conviction: 0.5,
      thesis: 'Macro headwinds offset institutional inflows. Wait for clearer direction.',
      keySignals: [
        {
          signalId: 'sig-002',
          type: 'SENTIMENT',
          title: 'Institutional buying accelerating',
          impact: 'POSITIVE',
          confidence: 0.7,
        },
      ],
      risks: ['Fed hawkish pivot risk'],
      opportunities: ['ETF approval catalysts'],
      memoryContext: null,
      priceTarget: null,
    },
  ],
  portfolio: {
    overallHealth: 'HEALTHY',
    summary: 'Portfolio well-positioned with strong equity performance and crypto hedging.',
    sectorThemes: ['Tech leadership', 'Crypto recovery'],
    macroContext: 'Fed holding rates steady, soft landing expected.',
    topRisks: ['Concentration in tech sector'],
    topOpportunities: ['Emerging market diversification'],
    actionItems: ['Consider adding healthcare exposure', 'Review BTC position after next Fed meeting'],
  },
  emotionState: {
    confidence: 0.75,
    riskAppetite: 0.6,
    reason: 'Positive earnings season with moderate macro uncertainty.',
  },
};

/**
 * Mock provider that tracks which agent is being called (via system prompt)
 * and returns scripted responses. The Strategist's response includes a
 * save_insight_report tool call.
 */
function createInsightsMockProvider(): AgentLoopProvider {
  let strategistCalls = 0;

  return {
    completeWithTools: vi.fn(async (params) => {
      const system = (params.system ?? '') as string;
      const sysLower = system.toLowerCase();

      // Detect agent by system prompt heading (specific to avoid false matches
      // e.g. RA prompt contains "bullish" in technicals table)
      const isStrategist = sysLower.includes('# strategist');
      const isBull = sysLower.includes('# bull researcher');
      const isBear = sysLower.includes('# bear researcher');

      if (isStrategist) {
        strategistCalls++;
        // First Strategist call: invoke save_insight_report tool
        if (strategistCalls === 1) {
          return {
            content: [
              { type: 'text' as const, text: 'Synthesizing portfolio insights...' },
              {
                type: 'tool_use' as const,
                id: `tool-call-strategist-${strategistCalls}`,
                name: 'save_insight_report',
                input: INSIGHT_REPORT_INPUT,
              },
            ] as ContentBlock[],
            stopReason: 'tool_use',
            usage: { inputTokens: 500, outputTokens: 200 },
          };
        }
        // After tool result, emit final response
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'Portfolio analysis complete. Report saved. ' +
                'Overall health: HEALTHY. Key action: diversify into healthcare.',
            },
          ] as ContentBlock[],
          stopReason: 'end_turn',
          usage: { inputTokens: 300, outputTokens: 100 },
        };
      }

      if (isBull) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'Bull case: AAPL has strong momentum with 8% earnings beat and rising RSI. ' +
                'BTC institutional adoption accelerating. Conviction: 4/5.',
            },
          ] as ContentBlock[],
          stopReason: 'end_turn',
          usage: { inputTokens: 200, outputTokens: 100 },
        };
      }

      if (isBear) {
        return {
          content: [
            {
              type: 'text' as const,
              text:
                'Bear case: AAPL P/E elevated at 31x, vulnerable to rate sensitivity. ' +
                'BTC facing regulatory headwinds and macro uncertainty. Conviction: 3/5.',
            },
          ] as ContentBlock[],
          stopReason: 'end_turn',
          usage: { inputTokens: 200, outputTokens: 100 },
        };
      }

      // Research Analyst or Risk Manager — generic analysis response
      return {
        content: [
          {
            type: 'text' as const,
            text:
              'Portfolio analysis: AAPL shows strong fundamentals with 8% earnings beat. ' +
              'BTC facing macro headwinds but institutional inflows rising. ' +
              'Portfolio concentrated in tech (65%) with moderate correlation risk.',
          },
        ] as ContentBlock[],
        stopReason: 'end_turn',
        usage: { inputTokens: 200, outputTokens: 100 },
      };
    }),
  };
}

describe('E2E ProcessInsights workflow', () => {
  let tempDir: string;
  let insightStore: InsightStore;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'yojin-insights-e2e-'));
    insightStore = new InsightStore(tempDir);

    const auditLog = new FileAuditLog(tempDir);
    const toolRegistry = new ToolRegistry();

    // Register the insight tool
    for (const tool of createInsightTools({ insightStore })) {
      toolRegistry.register(tool);
    }

    const agentRegistry = new AgentRegistry();
    agentRegistry.register(stubProfile('research-analyst'));
    agentRegistry.register(stubProfile('strategist', ['save_insight_report']));
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
      provider: createInsightsMockProvider(),
    });

    orchestrator = new Orchestrator(runtime);
    registerBuiltinWorkflows(orchestrator, { insightStore });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('executes the full process-insights workflow', async () => {
    const results = await orchestrator.execute('process-insights', {
      message: 'Process portfolio insights',
    });

    // All 5 agents should have produced output
    expect(results.has('research-analyst')).toBe(true);
    expect(results.has('risk-manager')).toBe(true);
    expect(results.has('bull-researcher')).toBe(true);
    expect(results.has('bear-researcher')).toBe(true);
    expect(results.has('strategist')).toBe(true);
  });

  it('persists an InsightReport via the save_insight_report tool', async () => {
    // Before: no reports
    const before = await insightStore.getLatest();
    expect(before).toBeNull();

    await orchestrator.execute('process-insights', {
      message: 'Process portfolio insights',
    });

    // After: report should be persisted
    const report = await insightStore.getLatest();
    expect(report).not.toBeNull();
    expect(report!.snapshotId).toBe('snap-test1234');
    expect(report!.positions).toHaveLength(2);
    expect(report!.positions[0].symbol).toBe('AAPL');
    expect(report!.positions[0].rating).toBe('BUY');
    expect(report!.positions[1].symbol).toBe('BTC');
    expect(report!.positions[1].rating).toBe('HOLD');
    expect(report!.portfolio.overallHealth).toBe('HEALTHY');
    expect(report!.portfolio.actionItems).toHaveLength(2);
    expect(report!.emotionState.confidence).toBe(0.75);
  });

  it('Strategist output includes the tool execution result', async () => {
    const results = await orchestrator.execute('process-insights', {
      message: 'Process portfolio insights',
    });

    const strategist = results.get('strategist');
    expect(strategist).toBeDefined();
    expect(strategist!.text).toContain('Portfolio analysis complete');
    // The agent ran 2 iterations (tool call + final response)
    expect(strategist!.iterations).toBe(2);
  });

  it('Research Analyst runs once with combined data gathering + analysis', async () => {
    const results = await orchestrator.execute('process-insights', {
      message: 'Process portfolio insights',
    });

    const research = results.get('research-analyst');
    expect(research).toBeDefined();
    expect(research!.text).toContain('analysis');
    // RA runs once (1 iteration), not twice
    expect(research!.iterations).toBe(1);
  });

  it('InsightReport schema validates correctly', async () => {
    await orchestrator.execute('process-insights', {
      message: 'Process portfolio insights',
    });

    const report = await insightStore.getLatest();
    expect(report).not.toBeNull();

    // Verify all required fields are present and correct types
    expect(typeof report!.id).toBe('string');
    expect(report!.id.length).toBeGreaterThan(0);
    expect(typeof report!.createdAt).toBe('string');
    expect(new Date(report!.createdAt).getTime()).not.toBeNaN();
    expect(typeof report!.durationMs).toBe('number');

    // Position insights
    for (const pos of report!.positions) {
      expect(['STRONG_BUY', 'BUY', 'HOLD', 'SELL', 'STRONG_SELL']).toContain(pos.rating);
      expect(pos.conviction).toBeGreaterThanOrEqual(0);
      expect(pos.conviction).toBeLessThanOrEqual(1);
      expect(pos.thesis.length).toBeGreaterThan(0);
      expect(pos.risks.length).toBeGreaterThan(0);
      expect(pos.opportunities.length).toBeGreaterThan(0);
    }

    // Portfolio insight
    expect(['STRONG', 'HEALTHY', 'CAUTIOUS', 'WEAK', 'CRITICAL']).toContain(report!.portfolio.overallHealth);
    expect(report!.portfolio.summary.length).toBeGreaterThan(0);

    // Emotion state
    expect(report!.emotionState.confidence).toBeGreaterThanOrEqual(0);
    expect(report!.emotionState.confidence).toBeLessThanOrEqual(1);
    expect(report!.emotionState.riskAppetite).toBeGreaterThanOrEqual(0);
    expect(report!.emotionState.riskAppetite).toBeLessThanOrEqual(1);
  });
});
