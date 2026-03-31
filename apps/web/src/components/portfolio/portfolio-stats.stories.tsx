import type { Meta, StoryObj } from '@storybook/react-vite';
import type { PortfolioSnapshot } from '../../api/types';
import PortfolioStats from './portfolio-stats';

const meta: Meta<typeof PortfolioStats> = {
  title: 'Portfolio/PortfolioStats',
  component: PortfolioStats,
  decorators: [
    (Story) => (
      <div style={{ width: 800 }}>
        <Story />
      </div>
    ),
  ],
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof PortfolioStats>;

const mockPortfolio: PortfolioSnapshot = {
  id: 'snap-001',
  positions: [
    {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      quantity: 150,
      costBasis: 145.0,
      currentPrice: 189.55,
      marketValue: 28432.5,
      unrealizedPnl: 6682.5,
      unrealizedPnlPercent: 30.71,
      dayChange: 3.21,
      dayChangePercent: 1.72,
      preMarketChange: null,
      preMarketChangePercent: null,
      postMarketChange: null,
      postMarketChangePercent: null,
      sparkline: [186, 187, 186.5, 188, 189, 188.5, 189, 189.55],
      sector: 'Technology',
      assetClass: 'EQUITY',
      platform: 'MANUAL',
      entryDate: null,
    },
    {
      symbol: 'BTC',
      name: 'Bitcoin',
      quantity: 0.45,
      costBasis: 35000.0,
      currentPrice: 41600.0,
      marketValue: 18720.0,
      unrealizedPnl: 2970.0,
      unrealizedPnlPercent: 18.86,
      dayChange: -520.0,
      dayChangePercent: -1.23,
      preMarketChange: null,
      preMarketChangePercent: null,
      postMarketChange: null,
      postMarketChangePercent: null,
      sparkline: [42200, 42000, 41800, 41900, 41700, 41500, 41650, 41600],
      sector: null,
      assetClass: 'CRYPTO',
      platform: 'MANUAL',
      entryDate: null,
    },
  ],
  totalValue: 47152.5,
  totalCost: 37500.0,
  totalPnl: 9652.5,
  totalPnlPercent: 25.74,
  totalDayChange: 481.5,
  totalDayChangePercent: 1.03,
  timestamp: '2026-03-19T12:00:00Z',
  platform: 'MANUAL',
  warnings: [],
  history: [],
  sectorExposure: [],
};

export const Default: Story = {
  args: { portfolio: mockPortfolio },
};

export const Empty: Story = {
  args: { portfolio: null },
};

export const NegativePnl: Story = {
  args: {
    portfolio: {
      ...mockPortfolio,
      totalPnl: -2500.0,
      totalPnlPercent: -6.67,
      totalDayChange: -350.0,
      totalDayChangePercent: -0.74,
    },
  },
};
