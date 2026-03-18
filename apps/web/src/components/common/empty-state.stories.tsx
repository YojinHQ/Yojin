import type { Meta, StoryObj } from '@storybook/react-vite';
import EmptyState from './empty-state';

const meta: Meta<typeof EmptyState> = {
  title: 'Common/EmptyState',
  component: EmptyState,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof EmptyState>;

export const Default: Story = {
  args: {
    title: 'No positions yet',
    description: 'Connect a brokerage account to start tracking your portfolio.',
  },
};

export const WithIcon: Story = {
  args: {
    icon: (
      <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 13.5h3.86a2.25 2.25 0 012.012 1.244l.256.512a2.25 2.25 0 002.013 1.244h3.218a2.25 2.25 0 002.013-1.244l.256-.512a2.25 2.25 0 012.013-1.244h3.859m-19.5.338V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18v-4.162" />
      </svg>
    ),
    title: 'No alerts configured',
    description: 'Set up price alerts, risk warnings, or portfolio notifications to stay informed.',
  },
};

export const WithAction: Story = {
  args: {
    icon: (
      <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
    ),
    title: 'No skills active',
    description: 'Browse the skill library to automate your investment workflow.',
    action: (
      <button className="rounded-lg bg-accent-primary px-4 py-2 text-sm font-medium text-white hover:bg-accent-secondary transition-colors">
        Browse Skills
      </button>
    ),
  },
};
