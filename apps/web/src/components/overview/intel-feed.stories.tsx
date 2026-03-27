import type { Meta, StoryObj } from '@storybook/react-vite';
import IntelFeed from './intel-feed';

const meta: Meta<typeof IntelFeed> = {
  title: 'Overview/IntelFeed',
  component: IntelFeed,
  decorators: [
    (Story) => (
      <div style={{ height: 700 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof IntelFeed>;

export const Default: Story = {};
