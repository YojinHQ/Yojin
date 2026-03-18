import type { Meta, StoryObj } from '@storybook/react-vite';
import Badge from './badge';

const meta: Meta<typeof Badge> = {
  title: 'Common/Badge',
  component: Badge,
  argTypes: {
    variant: { control: 'select', options: ['success', 'warning', 'error', 'info'] },
    children: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Badge>;

export const Success: Story = { args: { variant: 'success', children: 'Active' } };
export const Warning: Story = { args: { variant: 'warning', children: 'Pending' } };
export const Error: Story = { args: { variant: 'error', children: 'High Risk' } };
export const Info: Story = { args: { variant: 'info', children: 'Watching' } };

export const AllVariants: Story = {
  render: () => (
    <div className="flex gap-3">
      <Badge variant="success">Active</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="error">High Risk</Badge>
      <Badge variant="info">Watching</Badge>
    </div>
  ),
};
