import { useState, type FC } from 'react';
import { useNavigate } from 'react-router';
import type { BadgeVariant } from '../common/badge';
import Button from '../common/button';
import FeedDetailModal from './feed-detail-modal';
import type { FeedDetailData } from './feed-detail-modal';
import { cn } from '../../lib/utils';

/* ── Types ─────────────────────────────────────────────────────────── */

type EventCategory = 'Action' | 'Alert' | 'Insight';

type EventType = 'Fundamentals' | 'Filings' | 'News' | 'Socials' | 'Macro' | 'Trading Logic Trigger';

type FilterTab = 'All' | EventCategory;

interface FeedItemDetail {
  keyPoints: string[];
  analysis: string;
  recommendation?: string;
  relatedTickers?: string[];
  sentiment?: 'bullish' | 'bearish' | 'neutral';
  impact?: 'high' | 'medium' | 'low';
  confidence?: number;
}

export interface FeedItem {
  category: EventCategory;
  eventType: EventType;
  source: string;
  time: string;
  title: string;
  description?: string;
  urgency?: 'high' | 'medium' | 'low';
  preview: string;
  detail: FeedItemDetail;
}

/* ── Category config (drives label color + icon tint) ─────────────── */

const categoryConfig: Record<EventCategory, { variant: BadgeVariant; color: string; iconBg: string }> = {
  Action: { variant: 'accent', color: 'text-accent-primary', iconBg: 'bg-accent-primary/10' },
  Alert: { variant: 'warning', color: 'text-warning', iconBg: 'bg-warning/10' },
  Insight: { variant: 'success', color: 'text-success', iconBg: 'bg-success/10' },
};

const SECTION_ORDER: EventCategory[] = ['Action', 'Alert', 'Insight'];

const FILTER_TABS: { label: string; value: FilterTab }[] = [
  { label: 'All', value: 'All' },
  { label: 'Actions', value: 'Action' },
  { label: 'Alerts', value: 'Alert' },
  { label: 'Insights', value: 'Insight' },
];

/* ── Icons (by event type) ─────────────────────────────────────────── */

function ActionIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
      />
    </svg>
  );
}

function AlertIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
      />
    </svg>
  );
}

function InsightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
      />
    </svg>
  );
}

function FundamentalsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" d="M3.5 12V9M8 12V5.5M12.5 12V3" />
      <path strokeLinecap="round" d="M2 13.5h12" />
    </svg>
  );
}

function NewsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3}>
      <rect x="2" y="2.5" width="10" height="11" rx="1" />
      <path d="M12 5.5h1.5a.5.5 0 0 1 .5.5v6a2 2 0 0 1-2 2" />
      <path strokeLinecap="round" d="M4.5 5.5h2.5v2.5H4.5zM9 5.5h1.5M9 7.5h1.5M4.5 10h5" />
    </svg>
  );
}

function FilingsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3}>
      <path d="M4.5 2h5l3 3v8.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z" />
      <path d="M9.5 2v3h3" />
      <path strokeLinecap="round" d="M6 9h4M6 11.5h2.5" />
    </svg>
  );
}

function SocialsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3}>
      <path d="M2 3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3.5a1 1 0 0 1-1 1H5.5L3 10V8H3a1 1 0 0 1-1-1V3.5Z" />
      <path d="M6 9v1.5a1 1 0 0 0 1 1h3.5l2 1.5v-1.5h.5a1 1 0 0 0 1-1V7.5a1 1 0 0 0-1-1H11" />
    </svg>
  );
}

function MacroIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.3}>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12" />
      <path d="M8 2c-1.8 1.8-2.8 3.8-2.8 6s1 4.2 2.8 6c1.8-1.8 2.8-3.8 2.8-6S9.8 3.8 8 2Z" />
    </svg>
  );
}

/* ── Event type → icon mapping ─────────────────────────────────────── */

const eventTypeIcon: Record<EventType, FC<{ className?: string }>> = {
  Fundamentals: FundamentalsIcon,
  Filings: FilingsIcon,
  News: NewsIcon,
  Socials: SocialsIcon,
  Macro: MacroIcon,
  'Trading Logic Trigger': ActionIcon,
};

/* ── Fallback category icon (when no event type match) ─────────────── */

const categoryFallbackIcon: Record<EventCategory, FC<{ className?: string }>> = {
  Action: ActionIcon,
  Alert: AlertIcon,
  Insight: InsightIcon,
};

/* ── Button icons ────────────────────────────────────────────────── */

function ZapIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z"
      />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
      />
    </svg>
  );
}

/* ── Mock data ───────────────────────────────────────────────────── */

const feedItems: FeedItem[] = [
  /* ── Actions ─────────────────────────────────────────────────── */
  {
    category: 'Action',
    eventType: 'Trading Logic Trigger',
    source: 'Risk Manager',
    time: 'Now',
    title: 'Rebalance Portfolio',
    description: 'Tech allocation exceeds 45% target. Consider trimming NVDA position.',
    urgency: 'high',
    preview:
      'Your tech allocation has reached 47.3%, exceeding the 45% target. NVDA alone represents 18.2% of the portfolio, breaching the 15% single-stock guideline.',
    detail: {
      keyPoints: [
        'Technology sector weight: 47.3% (target: 45%, hard limit: 50%) — breached soft limit',
        'Single-stock concentration: NVDA at 18.2% exceeds the 15% guideline',
        'Portfolio beta to QQQ has risen to 1.24, indicating elevated tech sensitivity',
      ],
      analysis:
        "The portfolio's tech overweight has developed gradually as NVDA and other semiconductor names outperformed. While the positions have been profitable, the concentration creates asymmetric downside risk — a 10% tech correction would impact the portfolio 1.24x. Historical analysis shows that portfolios with sector weights above 45% experience 30% higher drawdowns during sector-specific selloffs. The current market environment of sector rotation makes this rebalancing particularly timely.",
      recommendation:
        'Consider trimming NVDA by 50-75 shares ($9,200-$13,800) to bring tech allocation below 42%. Redirect proceeds to underweight sectors: healthcare (current: 8%, target: 12%) and energy (current: 4%, target: 8%). Alternatively, add a QQQ put hedge to reduce effective beta.',
      relatedTickers: ['NVDA', 'AAPL', 'MSFT', 'QQQ'],
      confidence: 87,
    },
  },
  {
    category: 'Action',
    eventType: 'Trading Logic Trigger',
    source: 'Risk Manager',
    time: '30m',
    title: 'Stop Loss Approaching',
    description: 'META approaching -8% drawdown threshold. Review exit strategy.',
    urgency: 'high',
    preview:
      'META has declined 7.8% from recent peak, approaching your -8% drawdown threshold. Current unrealized P&L: -$2,340. Only $1.08 (0.2%) above trigger level.',
    detail: {
      keyPoints: [
        'META down 7.8% from 52-week high of $542 — your threshold is -8% (triggers at $498.64)',
        'Current price: $499.72 — only $1.08 (0.2%) above trigger level',
        'Volume has been 1.4x average on down days — institutional distribution pattern',
      ],
      analysis:
        "META's decline coincides with broader concerns about Reality Labs spending ($4.5B/quarter) and ad revenue growth deceleration. The stock has broken below its 50-day moving average ($518) and is testing the 100-day MA ($497). Volume patterns suggest institutional selling, which typically persists for 2-3 weeks. Technical support exists at $485 (200-day MA) and $460 (prior consolidation zone). The risk/reward at current levels is unfavorable with a 2:1 downside-to-upside ratio based on technical levels.",
      recommendation:
        'If $498.64 is breached, execute the planned stop: sell 50% of position (approximately $7,500). Hold remaining 50% with a tightened stop at $485 (200-day MA). If the 200-day holds, the risk/reward improves significantly. Consider redeploying proceeds into a high-quality name with better technical setup.',
      relatedTickers: ['META'],
      confidence: 91,
    },
  },

  /* ── Alerts ──────────────────────────────────────────────────── */
  {
    category: 'Alert',
    eventType: 'Fundamentals',
    source: 'Research Analyst',
    time: '15m',
    title: 'Earnings This Week',
    description: 'AAPL reports earnings Thursday after market close. Current position: 150 shares.',
    urgency: 'medium',
    preview:
      'AAPL reports Q1 earnings Thursday after market close. Consensus expects EPS of $2.11 on revenue of $124.1B. Options imply a ±5.2% post-earnings move.',
    detail: {
      keyPoints: [
        'Street consensus: EPS $2.11 (+6% YoY), Revenue $124.1B (+4.2% YoY)',
        "Options market implies ±5.2% post-earnings move — above AAPL's 4-quarter average of ±3.8%",
        'Your position: 150 shares at $182.40 avg cost — current unrealized gain: $5,610 (+20.4%)',
      ],
      analysis:
        "Apple's earnings this week carry elevated importance due to the AI narrative. Investors will focus on iPhone 16 sell-through rates, Services revenue growth (expected 14% YoY), and any updates on Apple Intelligence adoption metrics. The options-implied move of ±5.2% suggests uncertainty is above average. Key risk: China revenue, which has been declining for 3 consecutive quarters. Watch for commentary on enterprise AI partnerships announced last month.",
      recommendation:
        'Consider protective puts if position sizing exceeds 10% of portfolio (currently 8.3%). A $215 put expiring Friday would cost approximately $3.20/share ($480 total) and cap downside at -1.8% from current levels. Alternatively, take no action if comfortable with the position size.',
      relatedTickers: ['AAPL'],
      confidence: 74,
    },
  },
  {
    category: 'Alert',
    eventType: 'Fundamentals',
    source: 'Bloomberg',
    time: '3h',
    title: 'NVDA Reports Record Revenue',
    preview:
      'NVIDIA posted $22.1B in quarterly revenue, surpassing analyst estimates by 12%. Data center segment drove 76% of total revenue on unprecedented AI infrastructure demand.',
    detail: {
      keyPoints: [
        'Data center revenue surged 409% YoY to $18.4B, driven by unprecedented AI infrastructure demand',
        'Gross margin expanded to 76.7%, up from 64.6% a year ago — pricing power remains strong',
        'Management guided Q2 revenue of $28B ±2%, well above consensus of $24.6B',
      ],
      analysis:
        "NVIDIA's results confirm its position as the primary beneficiary of the AI infrastructure buildout. The data center segment's explosive growth reflects both hyperscaler capex cycles and enterprise AI adoption. However, the stock's forward P/E of 38x prices in significant continued growth. Key risks include potential demand pull-forward, emerging competition from AMD's MI300X and custom ASICs, and geopolitical restrictions on China sales. The guidance beat suggests the supply-demand imbalance for H100/B100 GPUs persists through at least mid-2025.",
      relatedTickers: ['NVDA', 'AMD', 'AVGO', 'SMH'],
      sentiment: 'bullish',
      impact: 'high',
    },
  },
  {
    category: 'Alert',
    eventType: 'Filings',
    source: 'SEC EDGAR',
    time: '5h',
    title: 'MSFT 10-K: Cloud Margin Expansion',
    preview:
      "Microsoft's annual filing reveals Azure operating margins reached 42%, up from 35% a year ago. Capital expenditure guidance raised to $52B for AI infrastructure build-out.",
    detail: {
      keyPoints: [
        'Azure operating margin reached 42%, expanding 700bps YoY — cloud profitability inflection point',
        'Capital expenditure guided to $52B for FY2025, up 38% YoY — primarily AI datacenter expansion',
        'Segment reporting shows AI revenue run rate exceeded $10B annualized for the first time',
      ],
      analysis:
        "Microsoft's 10-K filing reveals the structural economics of their AI strategy are improving faster than expected. The Azure margin expansion from 35% to 42% demonstrates that AI workloads carry higher margins than traditional cloud compute, likely due to premium pricing and GPU utilization rates above 90%. The $52B capex commitment signals confidence in sustained demand but also raises the stakes — if AI revenue growth decelerates, the return on invested capital could deteriorate. The new segment disclosure around AI revenue ($10B run rate) provides investors with better visibility into the AI contribution.",
      relatedTickers: ['MSFT', 'GOOGL', 'AMZN', 'ORCL'],
      sentiment: 'bullish',
      impact: 'medium',
    },
  },
  {
    category: 'Alert',
    eventType: 'Socials',
    source: 'StockTwits',
    time: '7h',
    title: 'TSLA Sentiment Surge',
    preview:
      'Social media mentions of TSLA jumped 340% this week with 78% bullish sentiment. Retail options activity shows heavy call buying at $280-$300 strikes.',
    detail: {
      keyPoints: [
        'TSLA social mentions jumped 340% week-over-week — highest volume since last earnings',
        'Bullish sentiment ratio at 78%, well above the 60% 90-day average',
        'Retail options activity shows concentrated call buying at $280-$300 strikes for next Friday expiry',
      ],
      analysis:
        'The social sentiment surge around TSLA reflects retail investor anticipation of the upcoming robotaxi event. Historical analysis shows that when TSLA social sentiment exceeds 75% bullish and mention volume spikes above 300%, the stock has moved ±8% in the following week (with a 60% probability of upward movement). However, elevated retail enthusiasm can also indicate crowded positioning — if the robotaxi reveal disappoints, the unwind could be swift. The heavy call buying at $280-$300 creates gamma exposure for dealers that may amplify moves in either direction.',
      relatedTickers: ['TSLA', 'UBER', 'LYFT'],
      sentiment: 'bullish',
      impact: 'medium',
    },
  },

  /* ── Insights ────────────────────────────────────────────────── */
  {
    category: 'Insight',
    eventType: 'Trading Logic Trigger',
    source: 'Strategist',
    time: '1h',
    title: 'Correlation Detected',
    description: 'MSFT and GOOGL showing 0.92 correlation over 30 days.',
    urgency: 'low',
    preview:
      '30-day rolling correlation between MSFT and GOOGL has risen to 0.92, up from 0.67 a month ago. Combined positions represent 14.8% of portfolio — effectively behaving as one position.',
    detail: {
      keyPoints: [
        'MSFT-GOOGL 30-day correlation: 0.92 (up from 0.67 thirty days ago)',
        'Both positions combined represent 14.8% of portfolio — effectively behaving as one position',
        'Historical mean correlation is 0.71 — current level is 1.8 sigma above average',
      ],
      analysis:
        "The spike in MSFT-GOOGL correlation is likely driven by the shared AI narrative — both stocks are moving on the same catalysts (cloud AI revenue, enterprise AI adoption, capex guidance). When correlations spike above 0.85, the diversification benefit of holding both positions drops significantly. Mathematically, at 0.92 correlation, the combined position's risk is 96% of what it would be if they were perfectly correlated — meaning you're getting almost zero diversification benefit. Historical analysis shows such spikes typically mean-revert within 45-60 days.",
      recommendation:
        "Monitor for mean reversion over the next 30 days. If correlation sustains above 0.85, consider reducing one position by 30-50% to restore diversification. GOOGL may be the trim candidate given its higher beta (1.15 vs MSFT's 0.98) and upcoming antitrust ruling risk.",
      relatedTickers: ['MSFT', 'GOOGL'],
      confidence: 68,
    },
  },
  {
    category: 'Insight',
    eventType: 'Macro',
    source: 'Reuters',
    time: '2h',
    title: 'Fed Signals Rate Adjustment',
    preview:
      'Federal Reserve officials indicated growing openness to adjusting interest rates, citing evolving inflation data and labor market conditions that may warrant policy recalibration.',
    detail: {
      keyPoints: [
        'FOMC minutes suggest growing consensus for a pause in rate hikes, with two members favoring a 25bp cut',
        'Core PCE inflation trending toward 2.4% — closer to target but still above the 2% goal',
        'Labor market showing signs of gradual cooling with unemployment ticking up to 3.9%',
      ],
      analysis:
        "The Federal Reserve's latest signals mark a notable shift in tone from recent hawkish positioning. While a rate cut isn't imminent, the language suggests the bar for maintaining current rates is rising. Bond markets have responded with a rally in longer-duration Treasuries, pushing the 10-year yield down 12bps. For equity portfolios, this creates a mixed signal: lower rates support valuations, but the underlying reason — economic softening — may pressure earnings growth in cyclical sectors. The market is currently pricing in a 62% probability of a rate cut by June.",
      relatedTickers: ['SPY', 'TLT', 'GLD', 'DXY'],
      sentiment: 'bearish',
      impact: 'high',
    },
  },
  {
    category: 'Insight',
    eventType: 'Socials',
    source: 'WSJ',
    time: '4h',
    title: 'Tech Sector Rotation Accelerates',
    preview:
      'Institutional investors are reducing technology exposure amid stretched valuations, rotating into energy and healthcare sectors. Large-cap tech funds saw $4.2B in net outflows over two weeks.',
    detail: {
      keyPoints: [
        'Large-cap tech funds saw $4.2B in net outflows over the past two weeks — largest since March 2024',
        'Nasdaq-100 forward P/E has reached 28.5x, 2.1 standard deviations above 10-year average',
        'Energy and healthcare sectors receiving inflows as investors seek relative value',
      ],
      analysis:
        'The rotation out of technology represents a healthy repricing rather than a fundamental deterioration. Fund flow data from EPFR shows institutional investors are not exiting equities but repositioning within them. The trigger appears to be valuation-driven: tech multiples have expanded 40% since October while earnings revisions have been flat. This rotation could persist for 4-8 weeks based on historical patterns, but structural AI tailwinds suggest tech underperformance will be shallow and temporary. Watch the QQQ/SPY ratio for reversal signals.',
      relatedTickers: ['XLK', 'XLE', 'XLV', 'QQQ'],
      sentiment: 'bearish',
      impact: 'medium',
    },
  },
  {
    category: 'Insight',
    eventType: 'News',
    source: 'CNBC',
    time: '6h',
    title: 'Apple Unveils Enterprise AI Features',
    preview:
      'Apple announced enterprise-focused AI capabilities including on-device document analysis and automated workflow tools, partnering with SAP and Salesforce for integration.',
    detail: {
      keyPoints: [
        "New 'Apple Intelligence for Business' suite runs entirely on-device, addressing enterprise data privacy concerns",
        'Partnership with SAP and Salesforce for workflow integration — targets $840B enterprise software market',
        'Analysts estimate potential $8-12B incremental revenue stream by FY2026 from enterprise AI services',
      ],
      analysis:
        "Apple's enterprise AI play leverages its unique advantage: on-device processing with Apple Silicon. While competitors rely on cloud AI, Apple's approach addresses the #1 enterprise concern — data privacy. The SAP/Salesforce partnerships are strategic, embedding Apple Intelligence into existing enterprise workflows. This move could accelerate iPhone and iPad refresh cycles in the enterprise segment (currently ~28% of device revenue). The $8-12B revenue estimate from analysts may be conservative if adoption follows the pattern of enterprise iPad deployments.",
      relatedTickers: ['AAPL', 'MSFT', 'GOOGL', 'CRM'],
      sentiment: 'bullish',
      impact: 'medium',
    },
  },
  {
    category: 'Insight',
    eventType: 'Macro',
    source: 'FT',
    time: '8h',
    title: 'European Markets Rally on Outlook',
    preview:
      'European equity markets posted broad gains as ECB signaled potential easing and manufacturing PMI data showed unexpected improvement, with Euro Stoxx 50 gaining 2.1%.',
    detail: {
      keyPoints: [
        'Euro Stoxx 50 gained 2.1%, led by German industrials and French luxury goods',
        'Eurozone manufacturing PMI rose to 48.7 from 46.1 — still contracting but improving rapidly',
        'ECB President Lagarde hinted at a June rate cut, the first since 2019',
      ],
      analysis:
        'European equities are benefiting from a confluence of positive catalysts: improving economic data, dovish central bank signals, and attractive valuations relative to US peers. The Euro Stoxx 50 trades at 13.2x forward earnings vs. 21.4x for the S&P 500 — a historically wide discount. The manufacturing PMI improvement suggests the industrial recession may be bottoming. For US-based investors, the EUR/USD move adds a currency tailwind. However, geopolitical risks (Ukraine, trade tensions) remain elevated and could reverse sentiment quickly.',
      relatedTickers: ['EWG', 'FEZ', 'VGK', 'HEDJ'],
      sentiment: 'bullish',
      impact: 'low',
    },
  },
];

/* ── Component ───────────────────────────────────────────────────── */

export default function NewsFeed() {
  const [activeFilter, setActiveFilter] = useState<FilterTab>('All');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [modalData, setModalData] = useState<FeedDetailData | null>(null);
  const navigate = useNavigate();

  const filteredItems = activeFilter === 'All' ? feedItems : feedItems.filter((item) => item.category === activeFilter);

  const grouped = SECTION_ORDER.map((cat) => ({
    category: cat,
    items: filteredItems.filter((item) => item.category === cat),
  })).filter((group) => group.items.length > 0);

  const showSectionHeaders = activeFilter === 'All';

  const toggleExpand = (key: string) => {
    setExpandedKey(expandedKey === key ? null : key);
  };

  const openDetail = (item: FeedItem) => {
    const config = categoryConfig[item.category];
    setModalData({
      title: item.title,
      source: item.source,
      time: item.time,
      tag: item.category,
      tagVariant: config.variant,
      urgency: item.urgency,
      confidence: item.detail.confidence,
      sentiment: item.detail.sentiment,
      impact: item.detail.impact,
      keyPoints: item.detail.keyPoints,
      analysis: item.detail.analysis,
      recommendation: item.detail.recommendation,
      relatedTickers: item.detail.relatedTickers,
    });
  };

  return (
    <>
      {/* ── Sticky header ──────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-bg-secondary">
        {/* Title + count badge */}
        <div className="flex items-center gap-2.5 px-4 pt-4 pb-1.5">
          <h2 className="font-headline text-base text-text-primary">Recommendations</h2>
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-primary px-1.5 text-[10px] font-bold text-white">
            {feedItems.length}
          </span>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-5 border-b border-border px-4">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => {
                setActiveFilter(tab.value);
                setExpandedKey(null);
              }}
              className={cn(
                'relative cursor-pointer pb-2.5 pt-1.5 text-xs font-medium transition-colors',
                activeFilter === tab.value ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              {tab.label}
              {activeFilter === tab.value && (
                <span className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-accent-primary" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Grouped feed items ─────────────────────────────────── */}
      <div className="space-y-5 p-3">
        {grouped.map(({ category, items }) => {
          const catConfig = categoryConfig[category];
          return (
            <div key={category}>
              {/* Section header */}
              {showSectionHeaders && (
                <h3 className={cn('mb-2.5 px-1 text-2xs font-semibold uppercase tracking-widest', catConfig.color)}>
                  {category}s
                </h3>
              )}

              {/* Cards */}
              <div className="space-y-2.5">
                {items.map((item) => {
                  const config = categoryConfig[item.category];
                  const Icon = eventTypeIcon[item.eventType] ?? categoryFallbackIcon[item.category];
                  const itemKey = `${item.category}-${item.eventType}-${item.title}`;
                  const expanded = expandedKey === itemKey;

                  return (
                    <div
                      key={itemKey}
                      className={cn(
                        'cursor-pointer rounded-xl border border-border-light bg-bg-tertiary transition-all',
                        expanded ? 'ring-1 ring-border-light' : 'hover:bg-bg-hover',
                      )}
                      onClick={() => toggleExpand(itemKey)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={expanded}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleExpand(itemKey);
                        }
                      }}
                    >
                      {/* Card header */}
                      <div className="flex items-center gap-3 px-2.5 py-2">
                        <div
                          className={cn(
                            'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                            config.iconBg,
                          )}
                        >
                          <Icon className={cn('h-4.5 w-4.5', config.color)} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <span className={cn('text-2xs font-semibold uppercase tracking-[0.1em]', config.color)}>
                            {item.category}
                          </span>
                          <p className="truncate text-sm font-medium leading-snug text-text-primary">{item.title}</p>
                        </div>
                        <span className="flex-shrink-0 text-2xs text-text-muted">{item.time}</span>
                      </div>

                      {/* Expandable preview */}
                      <div
                        className={cn(
                          'grid transition-[grid-template-rows] duration-200 ease-out',
                          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                        )}
                      >
                        <div className="overflow-hidden">
                          <div className="border-t border-border/30 px-3 pb-3">
                            <p className="mt-2 text-2xs leading-relaxed text-text-secondary">{item.preview}</p>
                            <div className="mt-3 flex items-center gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDetail(item);
                                }}
                              >
                                <ZapIcon />
                                View full analysis
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate('/chat', {
                                    state: {
                                      preset: `Analyze this ${item.category.toLowerCase()}: "${item.title}" — ${item.description ?? item.preview}`,
                                    },
                                  });
                                }}
                              >
                                <AgentIcon />
                                Add to Chat
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <FeedDetailModal open={modalData !== null} onClose={() => setModalData(null)} data={modalData} />
    </>
  );
}
