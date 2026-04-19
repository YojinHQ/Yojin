import type { Meta, StoryObj } from '@storybook/react-vite';
import FeedDetailModal, { type FeedDetailData } from './feed-detail-modal';

const actionData: FeedDetailData = {
  title: 'Social momentum rotation into safe-haven',
  source: 'STRATEGY: MOMENTUM_ROTATION',
  time: '2h ago',
  tag: 'HIGH',
  tagVariant: 'error',
  link: 'https://example.com/source',
  sentiment: 'bullish',
  confidence: 72,
  triggerStrength: 'STRONG',
  verdict: 'BUY',
  keyPoints: [
    'Social mentions up 340% week-over-week across retail forums',
    'Gold ETF inflows breaking 6-month range',
    'DXY weakness persisting despite hawkish Fed commentary',
  ],
  analysis:
    "Retail sentiment pivoted hard into gold as a safe-haven trade this week — social mentions up 340% and ETF inflows just broke a 6-month range. Options flow confirms the positioning shift is real, not noise.\n\nDXY is the swing factor. If the dollar strengthens, this invalidates fast; positioning is already crowded enough that any macro surprise unwinds it in a hurry. Scale in, don't chase.\n\nNot financial advice — your call.",
  recommendation: 'Scale into position over 3-5 days. Stop below $180 invalidates thesis.',
  relatedTickers: ['GLD', 'IAU', 'GDX', 'SLV'],
  actionMeta: {
    strategyName: 'Momentum Rotation',
    severity: 'HIGH',
    riskContext:
      'Portfolio currently 12% allocated to commodities.\nAdding 5% would bring total to 17%, within risk budget.',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
    sizeGuidance: 'Target 5% of portfolio. Scale in over 3-5 days.',
    suggestedQuantity: 45,
    suggestedValue: 8550,
    currentPrice: 190.25,
    entryRange: '$188 - $192',
    targetPrice: 215.0,
    stopLoss: 180.0,
    horizon: '2-4 weeks',
    conviction: 'HIGH',
    maxEntry: 195.0,
    catalystImpact: '+8% to +15%',
    pricedIn: false,
  },
};

const meta: Meta<typeof FeedDetailModal> = {
  title: 'Overview/FeedDetailModal',
  component: FeedDetailModal,
  parameters: { layout: 'fullscreen' },
};

export default meta;
type Story = StoryObj<typeof FeedDetailModal>;

export const ActionBuy: Story = {
  args: {
    open: true,
    onClose: () => {},
    data: actionData,
  },
};

export const ActionBuyPricedIn: Story = {
  args: {
    open: true,
    onClose: () => {},
    data: {
      ...actionData,
      actionMeta: actionData.actionMeta ? { ...actionData.actionMeta, pricedIn: true, currentPrice: 196.5 } : undefined,
    },
  },
};
