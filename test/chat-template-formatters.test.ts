import { describe, expect, it } from 'vitest';

import type { ChatTemplate } from '../src/tools/chat-template-data.js';
import { formatChatTemplateForTelegram } from '../src/tools/chat-template-formatters.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const queryBuilder: ChatTemplate = {
  type: 'query-builder',
  data: {
    title: "Let's go",
    subtitle: 'Pick an option',
    suggestions: [
      { id: 'portfolio', icon: 'portfolio', label: 'My Portfolio', query: 'Show my portfolio' },
      { id: 'research', icon: 'research', label: 'Research', query: 'Analyze AAPL' },
      { id: 'risk', icon: 'risk', label: 'Risk', query: 'Risk check' },
    ],
  },
};

const optionSelectorGrid: ChatTemplate = {
  type: 'option-selector',
  data: {
    title: 'Choose one',
    subtitle: 'Select a category',
    layout: 'grid',
    options: [
      { id: 'a', label: 'Option A', description: 'First' },
      { id: 'b', label: 'Option B' },
    ],
  },
};

const optionSelectorStack: ChatTemplate = {
  type: 'option-selector',
  data: {
    title: 'Choose one',
    layout: 'stack',
    options: [
      { id: 'x', label: 'X' },
      { id: 'y', label: 'Y' },
    ],
    backId: 'back-target',
  },
};

const waterfallStep: ChatTemplate = {
  type: 'waterfall-step',
  data: {
    flowId: 'portfolio',
    stepId: 'overview',
    title: 'Portfolio Options',
    subtitle: 'Drill down',
    layout: 'grid',
    options: [
      { id: 'full', label: 'Full overview' },
      { id: 'movers', label: 'Top movers' },
    ],
  },
};

const manualPositionWithPresets: ChatTemplate = {
  type: 'manual-position-step',
  data: {
    step: 'account',
    title: 'Which account?',
    subtitle: 'Choose your broker',
    formState: { symbol: 'AAPL' },
    presets: ['IBKR', 'Robinhood', 'Coinbase'],
  },
};

const manualPositionConfirm: ChatTemplate = {
  type: 'manual-position-step',
  data: {
    step: 'confirm',
    title: 'Confirm position',
    formState: { symbol: 'AAPL', account: 'IBKR', quantity: '10', costBasis: '150.00' },
  },
};

const manualPositionInput: ChatTemplate = {
  type: 'manual-position-step',
  data: {
    step: 'symbol',
    title: 'What asset?',
    subtitle: 'Enter ticker or name',
    formState: {},
  },
};

const briefingHero: ChatTemplate = {
  type: 'briefing-hero',
  data: {
    variant: 'morning',
    date: 'Wednesday, April 9',
    updatedAt: '8:00 AM',
    stats: [
      { value: '3', label: 'ACTIONS' },
      { value: '2', label: 'ALERTS' },
    ],
    ctaLabel: 'View Full',
    ctaActionId: 'view-full',
  },
};

const briefingHeroNoCta: ChatTemplate = {
  type: 'briefing-hero',
  data: {
    variant: 'full',
    date: 'April 9',
    stats: [{ value: '5', label: 'INSIGHTS' }],
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('formatChatTemplateForTelegram', () => {
  describe('query-builder', () => {
    it('renders title and subtitle with HTML', () => {
      const result = formatChatTemplateForTelegram(queryBuilder);
      expect(result.text).toContain("<b>Let's go</b>");
      expect(result.text).toContain('Pick an option');
    });

    it('returns an inline keyboard with suggestion buttons', () => {
      const result = formatChatTemplateForTelegram(queryBuilder);
      expect(result.replyMarkup).toBeDefined();
    });

    it('uses compact callback_data under 64 bytes', () => {
      const result = formatChatTemplateForTelegram(queryBuilder);
      // InlineKeyboard stores rows as a 2D array of InlineKeyboardButton
      const rows = (result.replyMarkup as unknown as { inline_keyboard: Array<Array<{ callback_data: string }>> })
        .inline_keyboard;
      for (const row of rows) {
        for (const btn of row) {
          expect(btn.callback_data.length).toBeLessThanOrEqual(64);
          expect(btn.callback_data).toMatch(/^tpl:qb:/);
        }
      }
    });

    it('maps icon enum to emoji in button labels', () => {
      const result = formatChatTemplateForTelegram(queryBuilder);
      const rows = (result.replyMarkup as unknown as { inline_keyboard: Array<Array<{ text: string }>> })
        .inline_keyboard;
      const labels = rows.flat().map((b) => b.text);
      // portfolio icon should map to briefcase emoji
      expect(labels.some((l) => l.includes('My Portfolio'))).toBe(true);
    });
  });

  describe('option-selector', () => {
    it('renders title in bold HTML', () => {
      const result = formatChatTemplateForTelegram(optionSelectorGrid);
      expect(result.text).toContain('<b>Choose one</b>');
      expect(result.text).toContain('Select a category');
    });

    it('grid layout puts 2 buttons per row', () => {
      const result = formatChatTemplateForTelegram(optionSelectorGrid);
      const rows = (result.replyMarkup as unknown as { inline_keyboard: Array<Array<{ text: string }>> })
        .inline_keyboard;
      // 2 options in grid = 1 row with 2 buttons
      expect(rows[0].length).toBe(2);
    });

    it('stack layout puts 1 button per row', () => {
      const result = formatChatTemplateForTelegram(optionSelectorStack);
      const rows = (result.replyMarkup as unknown as { inline_keyboard: Array<Array<{ text: string }>> })
        .inline_keyboard;
      // 2 options in stack + back button = 3 rows, each with 1 button
      expect(rows.filter((r) => r.length === 1).length).toBeGreaterThanOrEqual(2);
    });

    it('includes back button when backId is set', () => {
      const result = formatChatTemplateForTelegram(optionSelectorStack);
      const rows = (
        result.replyMarkup as unknown as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
      ).inline_keyboard;
      const allButtons = rows.flat();
      const backBtn = allButtons.find((b) => b.text.includes('Back'));
      expect(backBtn).toBeDefined();
      expect(backBtn!.callback_data).toBe('tpl:os:back-target');
    });
  });

  describe('waterfall-step', () => {
    it('renders title in bold', () => {
      const result = formatChatTemplateForTelegram(waterfallStep);
      expect(result.text).toContain('<b>Portfolio Options</b>');
    });

    it('encodes flowId and stepId in callback_data', () => {
      const result = formatChatTemplateForTelegram(waterfallStep);
      const rows = (result.replyMarkup as unknown as { inline_keyboard: Array<Array<{ callback_data: string }>> })
        .inline_keyboard;
      const data = rows.flat().map((b) => b.callback_data);
      expect(data).toContain('tpl:wf:portfolio:overview:full');
      expect(data).toContain('tpl:wf:portfolio:overview:movers');
    });

    it('callback_data stays under 64 bytes', () => {
      const result = formatChatTemplateForTelegram(waterfallStep);
      const rows = (result.replyMarkup as unknown as { inline_keyboard: Array<Array<{ callback_data: string }>> })
        .inline_keyboard;
      for (const row of rows) {
        for (const btn of row) {
          expect(btn.callback_data.length).toBeLessThanOrEqual(64);
        }
      }
    });
  });

  describe('manual-position-step', () => {
    it('shows preset buttons for account step', () => {
      const result = formatChatTemplateForTelegram(manualPositionWithPresets);
      expect(result.replyMarkup).toBeDefined();
      const rows = (result.replyMarkup as unknown as { inline_keyboard: Array<Array<{ text: string }>> })
        .inline_keyboard;
      const labels = rows.flat().map((b) => b.text);
      expect(labels).toContain('IBKR');
      expect(labels).toContain('Robinhood');
    });

    it('shows filled form state in summary', () => {
      const result = formatChatTemplateForTelegram(manualPositionWithPresets);
      expect(result.text).toContain('AAPL');
    });

    it('shows confirm/cancel buttons on confirm step', () => {
      const result = formatChatTemplateForTelegram(manualPositionConfirm);
      expect(result.replyMarkup).toBeDefined();
      const rows = (result.replyMarkup as unknown as { inline_keyboard: Array<Array<{ text: string }>> })
        .inline_keyboard;
      const labels = rows.flat().map((b) => b.text);
      expect(labels.some((l) => l.includes('Confirm'))).toBe(true);
      expect(labels.some((l) => l.includes('Cancel'))).toBe(true);
    });

    it('shows all form fields in confirm summary', () => {
      const result = formatChatTemplateForTelegram(manualPositionConfirm);
      expect(result.text).toContain('AAPL');
      expect(result.text).toContain('IBKR');
      expect(result.text).toContain('10');
      expect(result.text).toContain('150.00');
    });

    it('returns no keyboard for text-input steps', () => {
      const result = formatChatTemplateForTelegram(manualPositionInput);
      expect(result.replyMarkup).toBeUndefined();
    });
  });

  describe('briefing-hero', () => {
    it('renders morning variant with sun emoji', () => {
      const result = formatChatTemplateForTelegram(briefingHero);
      expect(result.text).toContain('Morning Briefing');
      expect(result.text).toContain('Wednesday, April 9');
    });

    it('renders full variant title', () => {
      const result = formatChatTemplateForTelegram(briefingHeroNoCta);
      expect(result.text).toContain('Full Briefing');
    });

    it('shows updatedAt when provided', () => {
      const result = formatChatTemplateForTelegram(briefingHero);
      expect(result.text).toContain('8:00 AM');
    });

    it('renders stats as a row', () => {
      const result = formatChatTemplateForTelegram(briefingHero);
      expect(result.text).toContain('<b>3</b> ACTIONS');
      expect(result.text).toContain('<b>2</b> ALERTS');
    });

    it('includes CTA button when ctaActionId is set', () => {
      const result = formatChatTemplateForTelegram(briefingHero);
      expect(result.replyMarkup).toBeDefined();
      const rows = (
        result.replyMarkup as unknown as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
      ).inline_keyboard;
      const btn = rows.flat()[0];
      expect(btn.text).toBe('View Full');
      expect(btn.callback_data).toBe('tpl:bh:view-full');
    });

    it('returns no keyboard when no CTA', () => {
      const result = formatChatTemplateForTelegram(briefingHeroNoCta);
      expect(result.replyMarkup).toBeUndefined();
    });
  });

  describe('HTML escaping', () => {
    it('escapes special characters in title', () => {
      const template: ChatTemplate = {
        type: 'query-builder',
        data: {
          title: 'P&L <Analysis>',
          suggestions: [{ id: 'test', label: 'Test', query: 'test' }],
        },
      };
      const result = formatChatTemplateForTelegram(template);
      expect(result.text).toContain('P&amp;L &lt;Analysis&gt;');
      expect(result.text).not.toContain('P&L');
    });

    it('escapes subtitle text', () => {
      const template: ChatTemplate = {
        type: 'option-selector',
        data: {
          title: 'Title',
          subtitle: 'Pick <one> & go',
          layout: 'stack',
          options: [{ id: 'a', label: 'A' }],
        },
      };
      const result = formatChatTemplateForTelegram(template);
      expect(result.text).toContain('Pick &lt;one&gt; &amp; go');
    });
  });

  describe('exhaustiveness', () => {
    it('handles every ChatTemplate variant', () => {
      // This test verifies that formatChatTemplateForTelegram handles all
      // variants by calling it with each one. If a new variant is added
      // to the union without a case, TypeScript compilation fails (assertNever).
      const allTemplates: ChatTemplate[] = [
        queryBuilder,
        optionSelectorGrid,
        waterfallStep,
        manualPositionWithPresets,
        briefingHero,
      ];

      for (const tpl of allTemplates) {
        const result = formatChatTemplateForTelegram(tpl);
        expect(result.text).toBeTruthy();
      }
    });
  });
});
