import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from '@storybook/test';
import { BarChart3, Search, ShieldAlert, Newspaper } from 'lucide-react';
import OptionSelector from './option-selector';

const meta: Meta<typeof OptionSelector> = {
  title: 'Chat/OptionSelector',
  component: OptionSelector,
  argTypes: {
    layout: { control: 'select', options: ['grid', 'stack'] },
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
type Story = StoryObj<typeof OptionSelector>;

const sampleOptions = [
  { id: 'portfolio', label: 'My Portfolio', icon: <BarChart3 className="h-4 w-4" /> },
  { id: 'research', label: 'Research a Stock', icon: <Search className="h-4 w-4" /> },
  { id: 'risk', label: 'Risk Check', icon: <ShieldAlert className="h-4 w-4" /> },
  { id: 'happening', label: "What's Happening", icon: <Newspaper className="h-4 w-4" /> },
];

export const Grid: Story = {
  args: {
    title: "Let's knock something off your list",
    options: sampleOptions,
    onSelect: fn(),
  },
};

export const WithSelected: Story = {
  args: {
    title: "Let's knock something off your list",
    options: sampleOptions,
    selectedId: 'portfolio',
    onSelect: fn(),
  },
};

export const Stack: Story = {
  args: {
    title: 'Choose a topic',
    options: sampleOptions,
    layout: 'stack',
    onSelect: fn(),
  },
};

export const WithSubtitle: Story = {
  args: {
    title: 'What would you like to explore?',
    subtitle: 'Pick a category to get started',
    options: sampleOptions,
    onSelect: fn(),
  },
};

export const WithBackButton: Story = {
  args: {
    title: 'Choose a sub-topic',
    options: [
      { id: 'allocation', label: 'Sector Allocation' },
      { id: 'performance', label: 'Performance History' },
      { id: 'holdings', label: 'Top Holdings' },
    ],
    onSelect: fn(),
    onBack: fn(),
  },
};

export const WithDescriptions: Story = {
  args: {
    title: 'Select an analysis',
    options: [
      { id: 'risk', label: 'Risk Analysis', description: 'Exposure, concentration, and correlation' },
      { id: 'earnings', label: 'Earnings Preview', description: 'Upcoming reports and estimates' },
      { id: 'rebalance', label: 'Rebalance', description: 'Optimize sector allocation' },
      { id: 'sentiment', label: 'Sentiment', description: 'Social and news sentiment scores' },
    ],
    onSelect: fn(),
  },
};
