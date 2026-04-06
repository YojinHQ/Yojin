/**
 * ToolRegistry — registers tools with Zod schemas, dispatches by name.
 *
 * Tools are scoped per agent profile. The registry holds a global pool;
 * callers request a subset by tool name list.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

import type { ToolDefinition, ToolExecutor, ToolResult, ToolSchema } from './types.js';

/**
 * Convert a Zod schema to JSON Schema, supporting both Zod v3 (from third-party
 * packages like @yojinhq/jintel-client) and Zod v4 (project-native schemas).
 *
 * Prefers Zod v4's built-in `toJSONSchema()`. Falls back to `zod-to-json-schema`
 * for v3 schemas or mixed v3/v4 compositions that the built-in cannot handle.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function schemaToJsonSchema(schema: any): Record<string, unknown> {
  let result: Record<string, unknown>;
  try {
    result = schema.toJSONSchema() as Record<string, unknown>;
  } catch {
    // Fall back to zod-to-json-schema for Zod v3 schemas or mixed compositions
    result = zodToJsonSchema(schema) as Record<string, unknown>;
  }
  // Anthropic API requires `type` at the top level of input_schema
  if (!result.type) {
    result.type = 'object';
  }
  return result;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class ToolRegistry implements ToolExecutor {
  private tools = new Map<string, ToolDefinition>();

  /** Register a tool. Throws if a tool with the same name already exists. */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Unregister a tool by name. Returns true if it existed. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Get a tool by name. */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Check if a tool is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /** Get all registered tool names. */
  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Get a subset of tools by name. Unknown names are silently skipped. */
  subset(names: string[]): ToolDefinition[] {
    return names.map((n) => this.tools.get(n)).filter(Boolean) as ToolDefinition[];
  }

  /** Get all registered tools. */
  all(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Execute a tool by name. Returns error result for unknown tools. */
  async execute(name: string, input: unknown, _context?: unknown): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true };
    }

    const parsed = tool.parameters.safeParse(input);
    if (!parsed.success) {
      return {
        content: `Invalid parameters for ${name}: ${parsed.error.message}`,
        isError: true,
      };
    }

    try {
      return await tool.execute(parsed.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: `Tool execution error (${name}): ${msg}`, isError: true };
    }
  }

  /** Convert tool definitions to the schema format expected by LLM providers. */
  toSchemas(tools?: ToolDefinition[]): ToolSchema[] {
    const list = tools ?? this.all();
    return list.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: schemaToJsonSchema(tool.parameters),
    }));
  }
}
