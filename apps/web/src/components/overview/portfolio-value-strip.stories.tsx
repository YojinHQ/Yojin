import type { Meta, StoryObj } from '@storybook/react-vite';
import PortfolioValueStrip from './portfolio-value-strip';

const meta: Meta<typeof PortfolioValueStrip> = {
  title: 'Overview/PortfolioValueStrip',
  component: PortfolioValueStrip,
  decorators: [
    (Story) => (
      <div style={{ width: 1000 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof PortfolioValueStrip>;

export const Default: Story = {};
