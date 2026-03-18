import type { Meta, StoryObj } from '@storybook/react-vite';
import ChatMessage from './chat-message';

const meta: Meta<typeof ChatMessage> = {
  title: 'Chat/ChatMessage',
  component: ChatMessage,
  argTypes: {
    role: { control: 'select', options: ['user', 'assistant'] },
    content: { control: 'text' },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 600 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof ChatMessage>;

export const UserMessage: Story = {
  args: {
    id: '1',
    role: 'user',
    content: 'How is my portfolio performing today?',
  },
};

export const AssistantMessage: Story = {
  args: {
    id: '2',
    role: 'assistant',
    content:
      'Your portfolio is up 1.2% today, outperforming the S&P 500 by 0.4%. NVDA is your top performer at +5.2%, while GOOGL is slightly down at -0.6%. Overall, 4 of your 5 positions are in the green.',
  },
};

export const Conversation: Story = {
  render: () => (
    <div className="space-y-4">
      <ChatMessage id="1" role="user" content="What's my current risk exposure?" />
      <ChatMessage
        id="2"
        role="assistant"
        content="Your portfolio has a moderate risk profile. Tech concentration is at 53.2%, exceeding the 45% target. I'd recommend reviewing your NVDA position which now represents 18% of total value."
      />
      <ChatMessage id="3" role="user" content="Should I trim the NVDA position?" />
      <ChatMessage
        id="4"
        role="assistant"
        content="Based on current analysis, trimming NVDA to 15% would bring your tech allocation closer to target. You could reallocate to defensive sectors for better diversification."
      />
    </div>
  ),
};
