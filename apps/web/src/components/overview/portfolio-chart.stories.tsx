import type { Meta, StoryObj } from '@storybook/react-vite';
import PortfolioChart from './portfolio-chart';

const meta: Meta<typeof PortfolioChart> = {
  title: 'Charts/PortfolioChart',
  component: PortfolioChart,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ width: 700, height: 400 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof PortfolioChart>;

export const Default: Story = {};
