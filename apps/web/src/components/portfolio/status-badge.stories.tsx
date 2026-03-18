import type { Meta, StoryObj } from '@storybook/react-vite';
import StatusBadge from './status-badge';

const meta: Meta<typeof StatusBadge> = {
  title: 'Portfolio/StatusBadge',
  component: StatusBadge,
  argTypes: {
    status: { control: 'select', options: ['holding', 'watching', 'pending', 'sold'] },
  },
};

export default meta;
type Story = StoryObj<typeof StatusBadge>;

export const Holding: Story = { args: { status: 'holding' } };
export const Watching: Story = { args: { status: 'watching' } };
export const Pending: Story = { args: { status: 'pending' } };
export const Sold: Story = { args: { status: 'sold' } };

export const AllStatuses: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <StatusBadge status="holding" />
      <StatusBadge status="watching" />
      <StatusBadge status="pending" />
      <StatusBadge status="sold" />
    </div>
  ),
};
