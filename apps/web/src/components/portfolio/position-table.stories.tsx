import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router';
import type { Position } from '../../api';
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

const mockPositions: Position[] = [
  {
    symbol: 'AAPL',
    name: 'Apple Inc.',
    assetClass: 'EQUITY',
    quantity: 150,
    costBasis: 145.0,
    currentPrice: 189.55,
    marketValue: 28432.5,
    unrealizedPnl: 6682.5,
    unrealizedPnlPercent: 30.71,
    sector: 'Technology',
    platform: 'MANUAL',
  },
  {
    symbol: 'NVDA',
    name: 'NVIDIA Corp.',
    assetClass: 'EQUITY',
    quantity: 45,
    costBasis: 380.0,
    currentPrice: 492.24,
    marketValue: 22150.75,
    unrealizedPnl: 5050.75,
    unrealizedPnlPercent: 29.53,
    sector: 'Technology',
    platform: 'MANUAL',
  },
  {
    symbol: 'BTC',
    name: 'Bitcoin',
    assetClass: 'CRYPTO',
    quantity: 0.45,
    costBasis: 35000.0,
    currentPrice: 41600.0,
    marketValue: 18720.0,
    unrealizedPnl: 2970.0,
    unrealizedPnlPercent: 18.86,
    sector: null,
    platform: 'MANUAL',
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
