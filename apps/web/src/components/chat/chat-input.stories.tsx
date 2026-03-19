import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from '@storybook/test';
import ChatInput from './chat-input';

const meta: Meta<typeof ChatInput> = {
  title: 'Chat/ChatInput',
  component: ChatInput,
  decorators: [
    (Story) => (
      <div style={{ width: 600 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ChatInput>;

export const Default: Story = {
  args: { onSend: fn() },
};

export const WithPlaceholder: Story = {
  args: {
    onSend: fn(),
    placeholder: 'Ask about your portfolio...',
  },
};

export const WithInitialValue: Story = {
  args: {
    onSend: fn(),
    initialValue: 'What is my risk exposure?',
  },
};

export const MultiLine: Story = {
  args: {
    onSend: fn(),
    initialValue: 'Line one\nLine two\nLine three\nThis demonstrates the auto-expanding textarea behavior.',
  },
};

export const Disabled: Story = {
  args: {
    onSend: fn(),
    disabled: true,
    placeholder: 'Waiting for response...',
  },
};
