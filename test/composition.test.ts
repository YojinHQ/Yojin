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

  it('registers 18 tools (with vault-locked stubs)', async () => {
    const services = await buildContext({ skipVault: true });
    const schemas = services.toolRegistry.toSchemas();

    // 2 starter + 4 credential stubs + 8 brain + 1 security audit
    // + 1 error analysis + 1 api health + 1 portfolio reasoning = 18
    expect(schemas.length).toBe(18);

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
  });

  it('registers 4 agent profiles', async () => {
    const services = await buildContext({ skipVault: true });
    const agents = services.agentRegistry.getAll();

    expect(agents.length).toBe(4);
    const ids = agents.map((a) => a.id).sort();
    expect(ids).toEqual(['research-analyst', 'risk-manager', 'strategist', 'trader']);
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
