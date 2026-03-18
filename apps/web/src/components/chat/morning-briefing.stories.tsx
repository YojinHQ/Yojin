import type { Meta, StoryObj } from '@storybook/react-vite';
import MorningBriefing from './morning-briefing';

const meta: Meta<typeof MorningBriefing> = {
  title: 'Chat/MorningBriefing',
  component: MorningBriefing,
  decorators: [
    (Story) => (
      <div style={{ width: 600 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof MorningBriefing>;

export const Default: Story = {};
