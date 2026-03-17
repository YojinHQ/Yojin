/**
 * ToolRegistry — registers tools with Zod schemas, dispatches by name.
 *
 * Tools are scoped per agent profile. The registry holds a global pool;
 * callers request a subset by tool name list.
 */

import type { ToolDefinition, ToolResult, ToolSchema } from './types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class ToolRegistry {
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
  async execute(name: string, input: unknown): Promise<ToolResult> {
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
      input_schema: zodToJsonSchema(tool.parameters) as Record<string, unknown>,
    }));
  }
}
