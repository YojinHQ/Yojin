import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

let defaultsRoot: string = '';
vi.mock('../../src/paths.js', () => ({
  resolveDefaultsRoot: () => defaultsRoot,
}));

import { AgentRegistry } from '../../src/agents/registry.js';
import type { AgentProfile } from '../../src/agents/types.js';
import { ToolRegistry } from '../../src/core/tool-registry.js';
import type { ToolDefinition } from '../../src/core/types.js';

function makeProfile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    role: 'analyst',
    description: 'A test agent.',
    tools: ['tool_a', 'tool_b'],
    allowedActions: ['tool_call'],
    capabilities: ['testing'],
    ...overrides,
  };
}

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Tool ${name}`,
    parameters: z.object({}),
    execute: async () => ({ content: `${name} executed` }),
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'agent-registry-test-'));
  defaultsRoot = join(tmpDir, 'defaults');
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('AgentRegistry', () => {
  it('registers and retrieves a profile', () => {
    const registry = new AgentRegistry();
    const profile = makeProfile();
    registry.register(profile);

    expect(registry.get('test-agent')).toEqual(profile);
    expect(registry.has('test-agent')).toBe(true);
  });

  it('throws on duplicate registration', () => {
    const registry = new AgentRegistry();
    registry.register(makeProfile());

    expect(() => registry.register(makeProfile())).toThrow('already registered');
  });

  it('throws on invalid profile shape', () => {
    const registry = new AgentRegistry();
    const invalid = makeProfile({ id: 'INVALID CAPS' });

    expect(() => registry.register(invalid)).toThrow('Invalid agent profile');
  });

  it('unregisters a profile', () => {
    const registry = new AgentRegistry();
    registry.register(makeProfile());

    expect(registry.unregister('test-agent')).toBe(true);
    expect(registry.has('test-agent')).toBe(false);
    expect(registry.unregister('test-agent')).toBe(false);
  });

  it('returns undefined for unknown profile', () => {
    const registry = new AgentRegistry();
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('getAll returns all profiles', () => {
    const registry = new AgentRegistry();
    registry.register(makeProfile({ id: 'agent-a', role: 'analyst' }));
    registry.register(makeProfile({ id: 'agent-b', role: 'strategist' }));

    const all = registry.getAll();
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.id).sort()).toEqual(['agent-a', 'agent-b']);
  });

  it('getByRole filters by role', () => {
    const registry = new AgentRegistry();
    registry.register(makeProfile({ id: 'analyst-1', role: 'analyst' }));
    registry.register(makeProfile({ id: 'strategist-1', role: 'strategist' }));
    registry.register(makeProfile({ id: 'analyst-2', role: 'analyst' }));

    const analysts = registry.getByRole('analyst');
    expect(analysts).toHaveLength(2);
    expect(analysts.every((p) => p.role === 'analyst')).toBe(true);

    const traders = registry.getByRole('trader');
    expect(traders).toHaveLength(0);
  });

  it('loadProfile resolves system prompt from file', async () => {
    const registry = new AgentRegistry();
    registry.register(makeProfile({ id: 'strategist', role: 'strategist' }));

    const agentDir = join(defaultsRoot, 'agents');
    await mkdir(agentDir, { recursive: true });
    await writeFile(join(agentDir, 'strategist.default.md'), '# Strategist\nYou decide.\n');

    const loaded = await registry.loadProfile('strategist', tmpDir);
    expect(loaded.systemPrompt).toBe('# Strategist\nYou decide.\n');
    expect(loaded.id).toBe('strategist');
    expect(loaded.role).toBe('strategist');
  });

  it('loadProfile throws for unknown agent', async () => {
    const registry = new AgentRegistry();

    await expect(registry.loadProfile('nonexistent', tmpDir)).rejects.toThrow('not found');
  });

  it('getToolsForAgent returns correct subset from ToolRegistry', () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register(makeProfile({ tools: ['tool_a', 'tool_c'] }));

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(makeTool('tool_a'));
    toolRegistry.register(makeTool('tool_b'));
    toolRegistry.register(makeTool('tool_c'));

    const tools = agentRegistry.getToolsForAgent('test-agent', toolRegistry);
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name).sort()).toEqual(['tool_a', 'tool_c']);
  });

  it('getToolsForAgent silently skips unregistered tools', () => {
    const agentRegistry = new AgentRegistry();
    agentRegistry.register(makeProfile({ tools: ['exists', 'missing'] }));

    const toolRegistry = new ToolRegistry();
    toolRegistry.register(makeTool('exists'));

    const tools = agentRegistry.getToolsForAgent('test-agent', toolRegistry);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe('exists');
  });

  it('getToolsForAgent throws for unknown agent', () => {
    const agentRegistry = new AgentRegistry();
    const toolRegistry = new ToolRegistry();

    expect(() => agentRegistry.getToolsForAgent('nonexistent', toolRegistry)).toThrow('not found');
  });
});
