import type { Meta, StoryObj } from '@storybook/react-vite';
import Input from './input';

const meta: Meta<typeof Input> = {
  title: 'Primitives/Input',
  component: Input,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md', 'lg'] },
    disabled: { control: 'boolean' },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 360 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { placeholder: 'Search symbols...' },
};

export const WithLabel: Story = {
  args: { label: 'Display Name', placeholder: 'Enter your name' },
};

export const WithHint: Story = {
  args: { label: 'API Key', placeholder: 'sk-...', hint: 'Your OpenBB API key for market data' },
};

export const WithError: Story = {
  args: { label: 'Email', value: 'invalid-email', error: 'Please enter a valid email address' },
};

export const Disabled: Story = {
  args: { label: 'Username', value: '@dean', disabled: true },
};

export const Small: Story = {
  args: { size: 'sm', placeholder: 'Filter...' },
};

export const Large: Story = {
  args: { size: 'lg', label: 'Portfolio Name', placeholder: 'My Portfolio' },
};

export const FormGroup: Story = {
  render: () => (
    <div className="space-y-4">
      <Input label="Display Name" placeholder="Enter your name" />
      <Input label="Email" type="email" placeholder="you@example.com" />
      <Input label="API Key" type="password" placeholder="sk-..." hint="Never shared with external services" />
    </div>
  ),
};
