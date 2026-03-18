import type { Meta, StoryObj } from '@storybook/react-vite';
import PortfolioSummary from './portfolio-summary';

const meta: Meta<typeof PortfolioSummary> = {
  title: 'Portfolio/PortfolioSummary',
  component: PortfolioSummary,
  decorators: [
    (Story) => (
      <div style={{ width: 900 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof PortfolioSummary>;

export const Default: Story = {};
