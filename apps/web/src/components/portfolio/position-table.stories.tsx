import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import PositionTable from './position-table';
import type { Position } from '../../api';

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

const mockPositions: Position[] = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'EQUITY',
    quantity: 150,
    costBasis: 175.0,
    currentPrice: 189.55,
    marketValue: 28432.5,
    unrealizedPnl: 2182.5,
    unrealizedPnlPercent: 8.31,
    sector: 'Technology',
    platform: 'INTERACTIVE_BROKERS',
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    assetClass: 'EQUITY',
    quantity: 45,
    costBasis: 420.0,
    currentPrice: 492.24,
    marketValue: 22150.75,
    unrealizedPnl: 3250.75,
    unrealizedPnlPercent: 17.2,
    sector: 'Technology',
    platform: 'INTERACTIVE_BROKERS',
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    assetClass: 'CRYPTO',
    quantity: 0.45,
    costBasis: 38000.0,
    currentPrice: 41600.0,
    marketValue: 18720.0,
    unrealizedPnl: 1620.0,
    unrealizedPnlPercent: 9.47,
    sector: null,
    platform: 'COINBASE',
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
