import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from '@storybook/test';
import QueryBuilder from './query-builder';

const meta: Meta<typeof QueryBuilder> = {
  title: 'Chat/QueryBuilder',
  component: QueryBuilder,
  decorators: [
    (Story) => (
      <div style={{ width: 500 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof QueryBuilder>;

export const Default: Story = {
  args: { onSelect: fn() },
};
