/**
 * First-run onboarding — asks the user a few questions and generates
 * a personalized persona for the Strategist agent.
 *
 * Runs once when no data/brain/persona.md override exists yet.
 * Uses the Anthropic provider to generate the persona from answers.
 */

import { createInterface } from 'node:readline';

import type { PersonaManager } from '../brain/types.js';
import type { AgentLoopProvider } from '../core/types.js';

// ---------------------------------------------------------------------------
// Terminal colors (reuse chat palette)
// ---------------------------------------------------------------------------

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  goldBold: '\x1b[1;33m',
  warmOrange: '\x1b[38;5;173m',
};

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

interface OnboardingAnswers {
  name: string;
  riskTolerance: string;
  assetClasses: string;
  communicationStyle: string;
  hardRules: string;
}

const QUESTIONS: { key: keyof OnboardingAnswers; prompt: string; default?: string }[] = [
  { key: 'name', prompt: 'What should I call you?' },
  {
    key: 'riskTolerance',
    prompt: 'Risk tolerance? (conservative / moderate / aggressive)',
    default: 'moderate',
  },
  {
    key: 'assetClasses',
    prompt: 'What do you mainly invest in? (stocks / crypto / both / other)',
    default: 'both',
  },
  {
    key: 'communicationStyle',
    prompt: 'How should I communicate? (concise / detailed / technical)',
    default: 'concise',
  },
  {
    key: 'hardRules',
    prompt: 'Any hard rules? (e.g. "max 20% in one position", or press Enter to skip)',
  },
];

// ---------------------------------------------------------------------------
// Prompt helper
// ---------------------------------------------------------------------------

function ask(rl: ReturnType<typeof createInterface>, question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` ${c.dim}[${defaultValue}]${c.reset}` : '';
  return new Promise((resolve) => {
    rl.question(`  ${c.warmOrange}?${c.reset} ${question}${suffix} `, (answer) => {
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

// ---------------------------------------------------------------------------
// Persona generation prompt
// ---------------------------------------------------------------------------

function buildGenerationPrompt(answers: OnboardingAnswers): string {
  return `Generate a concise persona profile in Markdown for a personal AI finance agent's "Strategist" personality.

The user provided these preferences:
- Name: ${answers.name || 'not provided'}
- Risk tolerance: ${answers.riskTolerance || 'moderate'}
- Asset classes: ${answers.assetClasses || 'stocks and crypto'}
- Communication style: ${answers.communicationStyle || 'concise'}
- Hard rules: ${answers.hardRules || 'none specified'}

Generate a Markdown document with:
1. A "# Persona:" title line with a short descriptive name
2. 4-6 bullet-style personality/behavior rules (first person "I")
3. A "## Communication Style" section with 3-5 style rules
${answers.hardRules ? '4. A "## Hard Rules" section with the user\'s constraints' : ''}

Keep it under 20 lines. Be specific and actionable, not generic. Use the user's name if provided.
Output ONLY the Markdown — no code fences, no preamble.`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runOnboarding(
  personaManager: PersonaManager,
  provider: AgentLoopProvider,
  model: string,
): Promise<void> {
  if (!process.stdin.isTTY) return;

  console.log(`\n${c.goldBold}Welcome to Yojin!${c.reset}`);
  console.log(`${c.dim}Let's set up your investment persona. This takes 30 seconds.${c.reset}\n`);

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const answers: OnboardingAnswers = {
    name: '',
    riskTolerance: '',
    assetClasses: '',
    communicationStyle: '',
    hardRules: '',
  };

  try {
    for (const q of QUESTIONS) {
      answers[q.key] = await ask(rl, q.prompt, q.default);
    }
  } finally {
    rl.close();
  }

  // Generate persona via LLM
  console.log(`\n  ${c.warmOrange}Generating your persona...${c.reset}`);

  const generationPrompt = buildGenerationPrompt(answers);

  const response = await provider.completeWithTools({
    model,
    system: 'You are a helpful assistant that generates persona profiles. Output only Markdown, no code fences.',
    messages: [{ role: 'user', content: generationPrompt }],
  });

  const personaText =
    response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { text: string }).text)
      .join('') || '';

  if (!personaText.trim()) {
    console.log(`  ${c.dim}Could not generate persona — using default.${c.reset}\n`);
    return;
  }

  await personaManager.setPersona(personaText.trim() + '\n');

  console.log(`  ${c.green}Persona saved!${c.reset}\n`);
  console.log(`${c.dim}${personaText.trim()}${c.reset}\n`);
  console.log(`${c.dim}You can update this anytime by asking me to change your persona.${c.reset}\n`);
}
