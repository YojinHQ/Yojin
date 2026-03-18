import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import PositionTable from './position-table';

const meta: Meta<typeof PositionTable> = {
  title: 'Portfolio/PositionTable',
  component: PositionTable,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div style={{ width: 900 }}>
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof PositionTable>;

const mockPositions = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'Equity',
    shares: 150,
    value: 28432.5,
    date: '2025-06-15',
    status: 'holding' as const,
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    assetClass: 'Equity',
    shares: 45,
    value: 22150.75,
    date: '2025-03-22',
    status: 'holding' as const,
  },
  {
    symbol: 'MSFT',
    name: 'Microsoft Corp.',
    assetClass: 'Equity',
    shares: 80,
    value: 15221.8,
    date: '2025-01-10',
    status: 'watching' as const,
  },
  {
    symbol: 'GOOGL',
    name: 'Alphabet Inc.',
    assetClass: 'Equity',
    shares: 60,
    value: 12845.2,
    date: '2025-08-05',
    status: 'pending' as const,
  },
  {
    symbol: 'META',
    name: 'Meta Platforms',
    assetClass: 'Equity',
    shares: 30,
    value: 8920.0,
    date: '2024-11-20',
    status: 'sold' as const,
  },
];

export const Default: Story = {
  args: { positions: mockPositions },
};

export const SinglePosition: Story = {
  args: { positions: [mockPositions[0]] },
};

export const Empty: Story = {
  args: { positions: [] },
};
