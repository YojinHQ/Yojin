import * as yaml from 'yaml';
import { z } from 'zod';

import { DataCapabilitySchema } from './capabilities.js';
import {
  StrategyCategorySchema,
  StrategySchema,
  StrategyTriggerSchema,
  TargetWeightsSchema,
  TriggerGroupSchema,
} from './types.js';
import type { Strategy } from './types.js';

const FrontmatterSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    category: StrategyCategorySchema,
    style: z.string().min(1),
    requires: z.array(DataCapabilitySchema).default([]),
    triggerGroups: z.array(TriggerGroupSchema).min(1).optional(),
    triggers: z.array(StrategyTriggerSchema).min(1).optional(),
    tickers: z.array(z.string()).default([]),
    maxPositionSize: z.number().min(0).max(1).optional(),
    targetAllocation: z.number().min(0).max(1).optional(),
    targetWeights: TargetWeightsSchema.optional(),
  })
  .refine((data) => data.triggerGroups || data.triggers, {
    message: 'Either triggerGroups or triggers must be provided',
  });

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function parseFromMarkdown(md: string): Strategy {
  const match = md.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('Invalid markdown: missing YAML frontmatter delimiters (---)');
  }

  const [, yamlStr, body] = match;
  let rawYaml: unknown;
  try {
    rawYaml = yaml.parse(yamlStr);
  } catch (err) {
    throw new Error(`Invalid YAML frontmatter: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  const frontmatter = FrontmatterSchema.parse(rawYaml);
  const content = body.trim();

  if (!content) {
    throw new Error('Markdown body (strategy content) cannot be empty');
  }

  const triggerGroups =
    frontmatter.triggerGroups ?? (frontmatter.triggers ?? []).map((t) => ({ label: '', conditions: [t] }));

  const strategy: Strategy = StrategySchema.parse({
    id: slugify(frontmatter.name),
    name: frontmatter.name,
    description: frontmatter.description,
    category: frontmatter.category,
    style: frontmatter.style,
    requires: frontmatter.requires,
    active: false,
    source: 'community',
    createdBy: 'community',
    createdAt: new Date().toISOString(),
    content,
    triggerGroups,
    maxPositionSize: frontmatter.maxPositionSize,
    targetAllocation: frontmatter.targetAllocation,
    tickers: frontmatter.tickers,
    targetWeights: frontmatter.targetWeights,
  });

  return strategy;
}

export function serializeToMarkdown(strategy: Strategy): string {
  const frontmatter: Record<string, unknown> = {
    name: strategy.name,
    description: strategy.description,
    category: strategy.category,
    style: strategy.style,
  };

  if (strategy.requires.length > 0) {
    frontmatter['requires'] = strategy.requires;
  }

  frontmatter['triggerGroups'] = strategy.triggerGroups.map((g) => ({
    ...(g.label ? { label: g.label } : {}),
    conditions: g.conditions.map((t) => ({
      type: t.type,
      description: t.description,
      ...(t.params ? { params: t.params } : {}),
    })),
  }));

  frontmatter['tickers'] = strategy.tickers;

  if (strategy.maxPositionSize !== undefined) {
    frontmatter['maxPositionSize'] = strategy.maxPositionSize;
  }

  if (strategy.targetAllocation !== undefined) {
    frontmatter['targetAllocation'] = strategy.targetAllocation;
  }

  if (strategy.targetWeights) {
    frontmatter['targetWeights'] = strategy.targetWeights;
  }

  const yamlStr = yaml.stringify(frontmatter, { lineWidth: 0 });
  return `---\n${yamlStr}---\n\n${strategy.content}\n`;
}
