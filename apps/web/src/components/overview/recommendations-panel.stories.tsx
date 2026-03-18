import type { Meta, StoryObj } from '@storybook/react-vite';
import RecommendationsPanel from './recommendations-panel';

const meta: Meta<typeof RecommendationsPanel> = {
  title: 'Overview/RecommendationsPanel',
  component: RecommendationsPanel,
  decorators: [
    (Story) => (
      <div style={{ height: 700 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof RecommendationsPanel>;

export const Default: Story = {};
