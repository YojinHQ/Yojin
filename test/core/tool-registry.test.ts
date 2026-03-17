import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/core/tool-registry.js';
import type { ToolDefinition } from '../../src/core/types.js';

function makeTool(
  name: string,
  handler?: (params: unknown) => Promise<{ content: string }>,
): ToolDefinition {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: z.object({ value: z.string().optional() }),
    execute: handler ?? (async () => ({ content: `${name} result` })),
  };
}

describe('ToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const reg = new ToolRegistry();
    const tool = makeTool('greet');
    reg.register(tool);

    expect(reg.has('greet')).toBe(true);
    expect(reg.get('greet')).toBe(tool);
    expect(reg.names()).toEqual(['greet']);
  });

  it('throws on duplicate registration', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('dup'));
    expect(() => reg.register(makeTool('dup'))).toThrow('Tool already registered: dup');
  });

  it('unregisters a tool', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('temp'));
    expect(reg.unregister('temp')).toBe(true);
    expect(reg.has('temp')).toBe(false);
    expect(reg.unregister('temp')).toBe(false);
  });

  it('returns a subset of tools', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('a'));
    reg.register(makeTool('b'));
    reg.register(makeTool('c'));

    const subset = reg.subset(['a', 'c', 'missing']);
    expect(subset.map((t) => t.name)).toEqual(['a', 'c']);
  });

  it('returns all tools', () => {
    const reg = new ToolRegistry();
    reg.register(makeTool('x'));
    reg.register(makeTool('y'));

    expect(reg.all()).toHaveLength(2);
  });

  describe('execute', () => {
    it('executes a tool and returns result', async () => {
      const reg = new ToolRegistry();
      reg.register(
        makeTool('echo', async (params) => {
          const { value } = params as { value?: string };
          return { content: value ?? 'empty' };
        }),
      );

      const result = await reg.execute('echo', { value: 'hello' });
      expect(result.content).toBe('hello');
      expect(result.isError).toBeUndefined();
    });

    it('returns error for unknown tool', async () => {
      const reg = new ToolRegistry();
      const result = await reg.execute('missing', {});
      expect(result.content).toBe('Unknown tool: missing');
      expect(result.isError).toBe(true);
    });

    it('returns error for invalid parameters', async () => {
      const reg = new ToolRegistry();
      reg.register({
        name: 'strict',
        description: 'strict tool',
        parameters: z.object({ required: z.string() }),
        execute: async () => ({ content: 'ok' }),
      });

      const result = await reg.execute('strict', {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('Invalid parameters');
    });

    it('catches execution errors gracefully', async () => {
      const reg = new ToolRegistry();
      reg.register(
        makeTool('fail', async () => {
          throw new Error('boom');
        }),
      );

      const result = await reg.execute('fail', {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain('boom');
    });
  });

  describe('toSchemas', () => {
    it('converts tools to JSON Schema format', () => {
      const reg = new ToolRegistry();
      reg.register(makeTool('test'));

      const schemas = reg.toSchemas();
      expect(schemas).toHaveLength(1);
      expect(schemas[0].name).toBe('test');
      expect(schemas[0].description).toBe('Test tool: test');
      expect(schemas[0].input_schema).toBeDefined();
      expect(schemas[0].input_schema).toHaveProperty('type', 'object');
    });

    it('converts a subset of tools', () => {
      const reg = new ToolRegistry();
      reg.register(makeTool('a'));
      reg.register(makeTool('b'));

      const schemas = reg.toSchemas(reg.subset(['a']));
      expect(schemas).toHaveLength(1);
      expect(schemas[0].name).toBe('a');
    });
  });
});
