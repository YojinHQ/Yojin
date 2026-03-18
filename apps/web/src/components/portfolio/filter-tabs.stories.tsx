import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import FilterTabs from './filter-tabs';
import type { FilterStatus } from './filter-tabs';

const meta: Meta<typeof FilterTabs> = {
  title: 'Portfolio/FilterTabs',
  component: FilterTabs,
  decorators: [
    (Story) => (
      <div style={{ width: 600 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof FilterTabs>;

const mockCounts: Record<FilterStatus, number> = {
  all: 10,
  holding: 5,
  watching: 2,
  pending: 2,
  sold: 1,
};

function ControlledFilterTabs() {
  const [active, setActive] = useState<FilterStatus>('all');
  return <FilterTabs activeFilter={active} onChange={setActive} counts={mockCounts} />;
}

export const Default: Story = {
  render: () => <ControlledFilterTabs />,
};

export const HoldingSelected: Story = {
  args: {
    activeFilter: 'holding',
    counts: mockCounts,
    onChange: () => {},
  },
};

export const EmptyCounts: Story = {
  args: {
    activeFilter: 'all',
    counts: { all: 0, holding: 0, watching: 0, pending: 0, sold: 0 },
    onChange: () => {},
  },
};
