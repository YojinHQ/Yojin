import type { Meta, StoryObj } from '@storybook/react-vite';
import TotalValueChart from './total-value-chart';

const meta: Meta<typeof TotalValueChart> = {
  title: 'Overview/TotalValueChart',
  component: TotalValueChart,
  decorators: [
    (Story) => (
      <div style={{ width: 700, height: 350 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof TotalValueChart>;

export const Default: Story = {};
