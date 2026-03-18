import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import Tabs from './tabs';

const meta: Meta<typeof Tabs> = {
  title: 'Primitives/Tabs',
  component: Tabs,
  argTypes: {
    size: { control: 'select', options: ['sm', 'md'] },
  },
};

export default meta;
type Story = StoryObj<typeof Tabs>;

function ControlledTabs(props: Omit<React.ComponentProps<typeof Tabs>, 'value' | 'onChange'> & { defaultValue?: string }) {
  const { defaultValue, tabs, ...rest } = props;
  const [value, setValue] = useState(defaultValue ?? tabs[0]?.value ?? '');
  return <Tabs {...rest} tabs={tabs} value={value} onChange={setValue} />;
}

export const Default: Story = {
  render: () => (
    <ControlledTabs tabs={[
      { label: 'Active', value: 'active' },
      { label: 'Builder', value: 'builder' },
    ]} />
  ),
};

export const Small: Story = {
  render: () => (
    <ControlledTabs
      size="sm"
      tabs={[
        { label: 'News', value: 'news' },
        { label: 'Intel', value: 'intel' },
      ]}
    />
  ),
};

export const MultipleOptions: Story = {
  render: () => (
    <ControlledTabs tabs={[
      { label: 'All', value: 'all' },
      { label: 'Holding', value: 'holding' },
      { label: 'Watching', value: 'watching' },
      { label: 'Pending', value: 'pending' },
      { label: 'Sold', value: 'sold' },
    ]} />
  ),
};

export const TimeRanges: Story = {
  render: () => (
    <ControlledTabs
      size="sm"
      defaultValue="1M"
      tabs={['1D', '1W', '1M', '3M', '1Y', 'ALL'].map((r) => ({ label: r, value: r }))}
    />
  ),
};
