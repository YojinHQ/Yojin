import type { Meta, StoryObj } from '@storybook/react-vite';
import SkillCard from './skill-card';
import type { Skill } from './types';

const meta: Meta<typeof SkillCard> = {
  title: 'Skills/SkillCard',
  component: SkillCard,
  decorators: [
    (Story) => (
      <div style={{ width: 340 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SkillCard>;

const baseSkill: Skill = {
  id: '1',
  name: 'Critical Drawdown Alert',
  description: 'Sends a critical alert and auto-drafts a hedge recommendation when any position exceeds -10% drawdown.',
  category: 'RISK',
  active: true,
  source: 'built-in',
  createdBy: 'Yojin',
  createdAt: 'Jan 3, 2026',
};

export const Risk: Story = {
  args: { skill: baseSkill },
};

export const Portfolio: Story = {
  args: {
    skill: {
      ...baseSkill,
      id: '2',
      name: 'Concentration Warning',
      description: 'Alerts when any single position exceeds 30% of portfolio value.',
      category: 'PORTFOLIO',
    },
  },
};

export const Market: Story = {
  args: {
    skill: {
      ...baseSkill,
      id: '3',
      name: 'Earnings Calendar Alert',
      description: 'Notifies you when a holding reports earnings within 3 days.',
      category: 'MARKET',
    },
  },
};

export const Research: Story = {
  args: {
    skill: {
      ...baseSkill,
      id: '4',
      name: 'Sentiment Shift Alert',
      description: 'Emails you when Jintel sentiment score shifts significantly.',
      category: 'RESEARCH',
      source: 'custom',
      createdBy: 'Dean',
      createdAt: 'Jan 12, 2026',
    },
  },
};

export const Inactive: Story = {
  args: {
    skill: { ...baseSkill, active: false },
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
      <SkillCard skill={baseSkill} />
      <SkillCard
        skill={{
          ...baseSkill,
          id: '2',
          name: 'Concentration Warning',
          description: 'Alerts when any single position exceeds 30% of portfolio value.',
          category: 'PORTFOLIO',
        }}
      />
      <SkillCard
        skill={{
          ...baseSkill,
          id: '3',
          name: 'Earnings Calendar',
          description: 'Notifies you when a holding reports earnings within 3 days.',
          category: 'MARKET',
        }}
      />
      <SkillCard
        skill={{
          ...baseSkill,
          id: '4',
          name: 'Sentiment Tracker',
          description: 'Monitors Jintel sentiment shifts for your holdings.',
          category: 'RESEARCH',
          source: 'custom',
          createdBy: 'Dean',
        }}
      />
    </div>
  ),
};
