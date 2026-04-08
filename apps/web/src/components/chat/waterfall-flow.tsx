import { useState, useCallback } from 'react';
import { cn } from '../../lib/utils';

/* ─── Tree types ─── */

interface WaterfallOption {
  id: string;
  label: string;
  description?: string;
  query?: string;
  action?: string;
  /** When true, the query is pre-filled in the input for editing instead of sent immediately. */
  prefill?: boolean;
  children?: WaterfallStep;
}

interface WaterfallStep {
  title: string;
  subtitle: string;
  layout: 'grid' | 'stack';
  options: WaterfallOption[];
}

/* ─── Prompt templates ─── */

const TREES: Record<string, WaterfallStep> = {
  portfolio: {
    title: 'My Portfolio',
    subtitle: 'Portfolio intelligence',
    layout: 'stack',
    options: [
      {
        id: 'overview',
        label: 'Full portfolio overview',
        description: 'Performance, allocation breakdown, and key metrics',
        query: 'Give me a full portfolio overview with allocation breakdown',
      },
      {
        id: 'performers',
        label: 'Best & worst performers',
        description: 'Top movers with explanations for each',
        query: 'What are my best and worst performers and why?',
      },
      {
        id: 'full-analysis',
        label: 'Complete portfolio analysis',
        description: 'Multi-agent deep dive — performance, risk, and watchlist',
        query: 'Run a complete portfolio analysis — performance, risk, and what to watch',
      },
      {
        id: 'rebalance',
        label: 'Rebalancing ideas',
        description: 'Strategist perspective on portfolio adjustments',
        query: 'How should I think about rebalancing my portfolio?',
      },
    ],
  },
  research: {
    title: 'Research a Stock',
    subtitle: 'Deep dive into any ticker',
    layout: 'stack',
    options: [
      {
        id: 'complete',
        label: 'Complete analysis',
        description: 'Fundamentals, technicals, news, and sentiment in one shot',
        query: 'Give me a complete analysis of [TICKER] — fundamentals, technicals, news, and sentiment',
        prefill: true,
      },
      {
        id: 'bull-bear',
        label: 'Bull vs bear case',
        description: 'Adversarial debate — strongest arguments for both sides',
        query: "What's the bull vs bear case for [TICKER]?",
        prefill: true,
      },
      {
        id: 'technicals',
        label: 'Technical analysis',
        description: 'RSI, MACD, Bollinger Bands, moving averages, and more',
        query: 'Show me the technicals for [TICKER] — RSI, MACD, Bollinger Bands, and moving averages',
        prefill: true,
      },
      {
        id: 'buzz',
        label: 'News & social buzz',
        description: 'Latest news, social sentiment, analyst research, and discussions',
        query: 'What are the latest news, social buzz, and analyst sentiment on [TICKER]?',
        prefill: true,
      },
    ],
  },
  risk: {
    title: 'Risk Check',
    subtitle: 'Portfolio risk analysis',
    layout: 'stack',
    options: [
      {
        id: 'full-risk',
        label: 'Full risk analysis',
        description: 'Concentration, correlations, and sector exposure',
        query: 'Analyze my portfolio risk — concentration, correlations, and sector exposure',
      },
      {
        id: 'correlations',
        label: 'Correlated positions',
        description: 'Find positions that move together and diversification gaps',
        query: 'Which of my positions are most correlated?',
      },
      {
        id: 'earnings',
        label: 'Upcoming earnings',
        description: 'Earnings calendar for all holdings with potential impact',
        query: 'Do I have earnings coming up that could move my positions?',
      },
      {
        id: 'drawdown',
        label: 'Drawdown risk',
        description: 'Stress test your portfolio against market downturns',
        query: "What's my drawdown risk if the market drops?",
      },
    ],
  },
  happening: {
    title: "What's Happening",
    subtitle: 'Market intelligence',
    layout: 'stack',
    options: [
      {
        id: 'briefing',
        label: 'Morning briefing',
        description: 'Full curated digest of what matters today',
        query: 'Give me a morning briefing',
      },
      {
        id: 'signals',
        label: 'Signals to watch',
        description: 'AI-curated signals prioritized for your portfolio',
        query: 'What signals should I pay attention to today?',
      },
      {
        id: 'macro',
        label: 'Macro outlook',
        description: 'GDP, inflation, interest rates, and S&P 500 multiples',
        query: "What's the macro outlook — GDP, inflation, and interest rates?",
      },
      {
        id: 'news-moves',
        label: 'News & moves',
        description: 'Significant news and price movements for your holdings',
        query: 'Any significant news or moves for my holdings today?',
      },
    ],
  },
};

/* ─── Component ─── */

interface WaterfallFlowProps {
  categoryId: string;
  onComplete: (query: string) => void;
  onPrefill?: (query: string) => void;
  onAction?: (action: string, displayLabel: string) => void;
  onCancel: () => void;
}

export default function WaterfallFlow({ categoryId, onComplete, onPrefill, onAction, onCancel }: WaterfallFlowProps) {
  const tree = TREES[categoryId];
  const [path, setPath] = useState<WaterfallStep[]>([tree]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [stepKey, setStepKey] = useState(0);

  const currentStep = path[path.length - 1];

  const handleSelect = useCallback(
    (optionId: string) => {
      const option = currentStep.options.find((o) => o.id === optionId);
      if (!option) return;

      setSelectedId(optionId);

      // Brief pause to show the selection highlight before transitioning
      setTimeout(() => {
        if (option.action) {
          onAction?.(option.action, option.query ?? option.label);
        } else if (option.prefill && option.query) {
          onPrefill?.(option.query);
        } else if (option.query) {
          onComplete(option.query);
        } else if (option.children) {
          const next = option.children;
          setPath((prev) => [...prev, next]);
          setSelectedId(undefined);
          setStepKey((k) => k + 1);
        }
      }, 250);
    },
    [currentStep, onComplete, onPrefill, onAction],
  );

  const handleBack = useCallback(() => {
    if (path.length > 1) {
      setPath((prev) => prev.slice(0, -1));
      setSelectedId(undefined);
      setStepKey((k) => k + 1);
    } else {
      onCancel();
    }
  }, [path, onCancel]);

  if (!tree) return null;

  return (
    <div key={stepKey} className="animate-waterfall-in">
      {/* Header with back button */}
      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-bg-tertiary text-text-secondary transition-colors hover:bg-bg-hover"
          aria-label="Go back"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h3 className="text-base font-semibold text-text-primary">{currentStep.title}</h3>
          <p className="text-xs text-text-muted">{currentStep.subtitle}</p>
        </div>
      </div>

      {/* Options */}
      <div className={cn(currentStep.layout === 'grid' ? 'grid grid-cols-2 gap-2.5' : 'flex flex-col gap-2.5')}>
        {currentStep.options.map((opt) => {
          const isSelected = opt.id === selectedId;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleSelect(opt.id)}
              className={cn(
                'relative cursor-pointer overflow-hidden rounded-xl border text-left transition-all duration-200',
                opt.description ? 'px-4 py-3.5' : 'px-3.5 py-3',
                isSelected
                  ? 'border-accent-primary/60 bg-gradient-to-r from-accent-primary/15 via-accent-primary/5 to-transparent'
                  : 'border-border/60 bg-bg-secondary hover:border-border-light hover:bg-bg-hover',
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition-colors duration-200',
                    isSelected ? 'bg-accent-primary' : 'bg-bg-tertiary',
                  )}
                >
                  <div
                    className={cn(
                      'h-2 w-2 rounded-full transition-colors duration-200',
                      isSelected ? 'bg-white' : 'bg-text-muted',
                    )}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{opt.label}</span>
                    {opt.prefill && (
                      <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-2xs text-text-muted">edit</span>
                    )}
                  </div>
                  {opt.description && <div className="mt-0.5 text-xs text-text-muted">{opt.description}</div>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
