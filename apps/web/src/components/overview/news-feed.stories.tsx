import type { Meta, StoryObj } from '@storybook/react-vite';
import NewsFeed from './news-feed';

const meta: Meta<typeof NewsFeed> = {
  title: 'Overview/NewsFeed',
  component: NewsFeed,
  decorators: [
    (Story) => (
      <div style={{ width: 320 }} className="border border-border rounded-lg overflow-hidden">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof NewsFeed>;

export const Default: Story = {};
