import { describe, expect, it } from 'vitest';

import { buildContext } from '../src/composition.js';

describe('buildContext', () => {
  it('builds services with all tools registered (vault skipped)', async () => {
    const services = await buildContext({ skipVault: true, dataRoot: '.' });

    expect(services.config).toBeDefined();
    expect(services.toolRegistry).toBeDefined();
    expect(services.agentRegistry).toBeDefined();
    expect(services.guardRunner).toBeDefined();
    expect(services.outputDlp).toBeDefined();
    expect(services.auditLog).toBeDefined();
    expect(services.pluginRegistry).toBeDefined();
    expect(services.dataSourceRegistry).toBeDefined();

    // Vault should be undefined when skipped
    expect(services.vault).toBeUndefined();
  });

  it('registers 40 tools (with vault-locked stubs)', async () => {
    const services = await buildContext({ skipVault: true });
    const schemas = services.toolRegistry.toSchemas();

    // 2 starter + 4 credential stubs + 8 brain + 1 security audit
    // + 10 jintel tools (search, enrich, batch_enrich, quotes, sanctions, run_technical, gdp, inflation, interest_rates, sp500_multiples)
    // + 3 watchlist tools + 3 signal tools
    // + 1 error analysis + 1 api health + 1 portfolio reasoning
    // + 2 portfolio tools (save_portfolio_positions, get_portfolio)
    // + 1 insight tool (save_insight_report)
    // + 1 assessment tool (save_signal_assessment)
    // + 2 data source query tools (query_data_source, list_data_sources)
    // + 2 memory tools (store_signal_memory, recall_signal_memories)
    // + 4 display tools (display_portfolio_overview, display_positions_list, display_allocation, display_morning_briefing)
    // = 46
    expect(schemas.length).toBe(46);

    const names = schemas.map((s) => s.name).sort();
    expect(names).toContain('get_current_time');
    expect(names).toContain('calculate');
    expect(names).toContain('store_credential');
    expect(names).toContain('check_credential');
    expect(names).toContain('list_credentials');
    expect(names).toContain('delete_credential');
    expect(names).toContain('brain_get_memory');
    expect(names).toContain('brain_update_memory');
    expect(names).toContain('brain_get_emotion');
    expect(names).toContain('brain_update_emotion');
    expect(names).toContain('brain_get_persona');
    expect(names).toContain('brain_set_persona');
    expect(names).toContain('brain_get_log');
    expect(names).toContain('brain_rollback');
    expect(names).toContain('security_audit_check');
    expect(names).toContain('diagnose_data_error');
    expect(names).toContain('check_api_health');
    expect(names).toContain('portfolio_reasoning');
    expect(names).toContain('store_signal_memory');
    expect(names).toContain('recall_signal_memories');
    // Jintel tools
    expect(names).toContain('search_entities');
    expect(names).toContain('enrich_entity');
    expect(names).toContain('batch_enrich');
    expect(names).toContain('market_quotes');
    expect(names).toContain('sanctions_screen');
    // Signal tools
    expect(names).toContain('glob_signals');
    expect(names).toContain('grep_signals');
    expect(names).toContain('read_signal');
    // Watchlist tools
    expect(names).toContain('watchlist_add');
    expect(names).toContain('watchlist_remove');
    expect(names).toContain('watchlist_list');
    // Display tools
    expect(names).toContain('display_portfolio_overview');
    expect(names).toContain('display_positions_list');
    expect(names).toContain('display_allocation');
    expect(names).toContain('display_morning_briefing');
  });

  it('registers 6 agent profiles', async () => {
    const services = await buildContext({ skipVault: true });
    const agents = services.agentRegistry.getAll();

    expect(agents.length).toBe(6);
    const ids = agents.map((a) => a.id).sort();
    expect(ids).toEqual([
      'bear-researcher',
      'bull-researcher',
      'research-analyst',
      'risk-manager',
      'strategist',
      'trader',
    ]);
  });

  it('vault-locked stubs return error messages', async () => {
    const services = await buildContext({ skipVault: true });

    const result = await services.toolRegistry.execute('store_credential', {
      key: 'TEST_KEY',
      description: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Vault is locked');
  });

  it('guard runner is frozen after construction', async () => {
    const services = await buildContext({ skipVault: true });

    // Frozen guard runner should throw if we try to add guards
    expect(() => {
      // @ts-expect-error — testing internal freeze behavior
      services.guardRunner.addGuard?.({});
    }).toThrow?.();
  });

  it('can scope tools to an agent profile', async () => {
    const services = await buildContext({ skipVault: true });
    const { agentRegistry, toolRegistry } = services;

    const strategistTools = agentRegistry.getToolsForAgent('strategist', toolRegistry);
    const toolNames = strategistTools.map((t) => t.name);

    // Strategist should have brain tools
    expect(toolNames).toContain('brain_get_memory');
    expect(toolNames).toContain('brain_update_emotion');
    expect(toolNames).toContain('portfolio_reasoning');

    // Strategist should NOT have trader tools
    expect(toolNames).not.toContain('connect_platform');
  });
});
