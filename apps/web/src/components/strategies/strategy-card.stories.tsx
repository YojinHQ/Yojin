import type { Meta, StoryObj } from '@storybook/react-vite';
import StrategyCard from './strategy-card';
import type { Strategy } from './types';

const meta: Meta<typeof StrategyCard> = {
  title: 'Strategies/StrategyCard',
  component: StrategyCard,
  decorators: [
    (Story) => (
      <div style={{ width: 340 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof StrategyCard>;

const baseStrategy: Strategy = {
  id: '1',
  name: 'Critical Drawdown Alert',
  description: 'Sends a critical alert and auto-drafts a hedge recommendation when any position exceeds -10% drawdown.',
  category: 'RISK',
  style: 'DEFENSIVE',
  requires: [],
  active: true,
  source: 'built-in',
  createdBy: 'YojinHQ/trading-strategies',
  createdAt: '2026-01-03T08:00:00.000Z',
  content: '',
  triggerGroups: [{ label: null, conditions: [{ type: 'DRAWDOWN', description: 'Position drawdown exceeds -10%' }] }],
  tickers: [],
};

export const Risk: Story = {
  args: { strategy: baseStrategy },
};

export const Portfolio: Story = {
  args: {
    strategy: {
      ...baseStrategy,
      id: '2',
      name: 'Concentration Warning',
      description: 'Alerts when any single position exceeds 30% of portfolio value.',
      category: 'PORTFOLIO',
      style: 'GENERAL',
    },
  },
};

export const Market: Story = {
  args: {
    strategy: {
      ...baseStrategy,
      id: '3',
      name: 'Earnings Calendar Alert',
      description: 'Notifies you when a holding reports earnings within 3 days.',
      category: 'MARKET',
      style: 'EVENT_DRIVEN',
    },
  },
};

export const Research: Story = {
  args: {
    strategy: {
      ...baseStrategy,
      id: '4',
      name: 'Sentiment Shift Alert',
      description: 'Emails you when Jintel sentiment score shifts significantly.',
      category: 'RESEARCH',
      style: 'MOMENTUM',
      source: 'custom',
      createdBy: 'Dean',
      createdAt: '2026-01-12T08:00:00.000Z',
    },
  },
};

export const Inactive: Story = {
  args: {
    strategy: { ...baseStrategy, active: false },
  },
};

export const Community: Story = {
  args: {
    strategy: {
      ...baseStrategy,
      id: '6',
      name: 'Sector Rotation Signal',
      source: 'community',
      style: 'GENERAL',
      createdBy: 'Community',
    },
  },
};

export const AllCategories: Story = {
  decorators: [
    (Story) => (
      <div style={{ width: 740 }}>
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div className="grid grid-cols-2 gap-4">
      <StrategyCard strategy={baseStrategy} />
      <StrategyCard
        strategy={{
          ...baseStrategy,
          id: '2',
          name: 'Concentration Warning',
          description: 'Alerts when any single position exceeds 30% of portfolio value.',
          category: 'PORTFOLIO',
          style: 'GENERAL',
        }}
      />
      <StrategyCard
        strategy={{
          ...baseStrategy,
          id: '3',
          name: 'Earnings Calendar',
          description: 'Notifies you when a holding reports earnings within 3 days.',
          category: 'MARKET',
          style: 'EVENT_DRIVEN',
        }}
      />
      <StrategyCard
        strategy={{
          ...baseStrategy,
          id: '4',
          name: 'Sentiment Tracker',
          description: 'Monitors Jintel sentiment shifts for your holdings.',
          category: 'RESEARCH',
          style: 'MOMENTUM',
          source: 'custom',
          createdBy: 'Dean',
        }}
      />
    </div>
  ),
};
