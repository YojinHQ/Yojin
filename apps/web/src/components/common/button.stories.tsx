import type { Meta, StoryObj } from '@storybook/react-vite';
import Button from './button';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger'] },
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    loading: { control: 'boolean' },
    disabled: { control: 'boolean' },
    children: { control: 'text' },
  },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { children: 'Connect Account' } };
export const Secondary: Story = { args: { variant: 'secondary', children: 'Cancel' } };
export const Ghost: Story = { args: { variant: 'ghost', children: 'View Details' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Disconnect' } };

export const Small: Story = { args: { size: 'sm', children: 'Add Rule' } };
export const Large: Story = { args: { size: 'lg', children: 'Start Analysis' } };

export const Loading: Story = { args: { loading: true, children: 'Analyzing...' } };
export const Disabled: Story = { args: { disabled: true, children: 'Send' } };

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
    </div>
  ),
};

export const AllSizes: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Button>Default</Button>
      <Button loading>Loading</Button>
      <Button disabled>Disabled</Button>
    </div>
  ),
};
