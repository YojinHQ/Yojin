import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import PositionsPreview from './positions-preview';

const meta: Meta<typeof PositionsPreview> = {
  title: 'Overview/PositionsPreview',
  component: PositionsPreview,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div style={{ width: 600, height: 300 }}>
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof PositionsPreview>;

export const Default: Story = {};
