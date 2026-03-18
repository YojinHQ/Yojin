import type { Meta, StoryObj } from '@storybook/react-vite';
import PortfolioStats from './portfolio-stats';

const meta: Meta<typeof PortfolioStats> = {
  title: 'Portfolio/PortfolioStats',
  component: PortfolioStats,
  decorators: [
    (Story) => (
      <div style={{ width: 800 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof PortfolioStats>;

export const Default: Story = {};
