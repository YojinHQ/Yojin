import type { Meta, StoryObj } from '@storybook/react-vite';
import AllocationChart from './allocation-chart';

const meta: Meta<typeof AllocationChart> = {
  title: 'Charts/AllocationChart',
  component: AllocationChart,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div style={{ height: 250 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof AllocationChart>;

export const Default: Story = {};
