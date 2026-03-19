import { useState, useCallback } from 'react';
import { cn } from '../../lib/utils';

/* ─── Tree types ─── */

interface WaterfallOption {
  id: string;
  label: string;
  description?: string;
  query?: string;
  action?: string;
  children?: WaterfallStep;
}

interface WaterfallStep {
  title: string;
  subtitle: string;
  layout: 'grid' | 'stack';
  options: WaterfallOption[];
}

/* ─── Decision trees ─── */

const TREES: Record<string, WaterfallStep> = {
  portfolio: {
    title: 'What about your portfolio?',
    subtitle: 'Portfolio insights',
    layout: 'grid',
    options: [
      {
        id: 'perf',
        label: 'Performance overview',
        children: {
          title: 'What timeframe?',
          subtitle: 'Performance period',
          layout: 'stack',
          options: [
            {
              id: 'today',
              label: 'Today',
              description: "Today's performance snapshot",
              action: 'tool:portfolio-overview:today',
              query: 'How is my portfolio performing today?',
            },
            {
              id: 'week',
              label: 'This week',
              description: 'Weekly performance summary',
              action: 'tool:portfolio-overview:week',
              query: 'How has my portfolio performed this week?',
            },
            {
              id: 'ytd',
              label: 'Year to date',
              description: 'Full year performance review',
              action: 'tool:portfolio-overview:ytd',
              query: 'Show me my portfolio YTD performance',
            },
          ],
        },
      },
      {
        id: 'alloc',
        label: 'Allocation breakdown',
        action: 'tool:allocation',
        query: 'Show me my portfolio allocation by sector and asset class',
      },
      {
        id: 'rebalance',
        label: 'Rebalancing ideas',
        query: 'What rebalancing moves should I consider?',
      },
      {
        id: 'benchmark',
        label: 'Benchmark comparison',
        query: 'How does my portfolio compare to the S&P 500?',
      },
      {
        id: 'add-asset',
        label: 'Add asset',
        description: 'Manually add a position',
        action: 'add-asset',
      },
    ],
  },
  risk: {
    title: 'What would you like to analyze?',
    subtitle: 'Risk & exposure options',
    layout: 'grid',
    options: [
      {
        id: 'concentration',
        label: 'Concentration risk',
        query: 'Which positions are too concentrated in my portfolio?',
      },
      {
        id: 'sector',
        label: 'Sector exposure',
        query: 'Show me my sector exposure breakdown',
      },
      {
        id: 'correlation',
        label: 'Correlation analysis',
        query: 'Are any of my positions highly correlated?',
      },
      {
        id: 'earnings',
        label: 'Earnings calendar',
        query: 'Which of my holdings have upcoming earnings?',
      },
    ],
  },
  positions: {
    title: 'Which positions interest you?',
    subtitle: 'Position details',
    layout: 'grid',
    options: [
      {
        id: 'top',
        label: 'Top performers',
        action: 'tool:positions-list:top',
        query: 'Show me my top performing positions',
      },
      {
        id: 'worst',
        label: 'Underperformers',
        action: 'tool:positions-list:worst',
        query: 'Which positions are underperforming?',
      },
      {
        id: 'movers',
        label: "Today's movers",
        action: 'tool:positions-list:movers',
        query: 'What moved most in my portfolio today?',
      },
      {
        id: 'all',
        label: 'All positions',
        action: 'tool:positions-list:all',
        query: 'List all my current positions with key metrics',
      },
    ],
  },
  trends: {
    title: 'What trends interest you?',
    subtitle: 'Market intelligence',
    layout: 'grid',
    options: [
      {
        id: 'movers',
        label: 'Market movers',
        query: 'What are the biggest market movers today?',
      },
      {
        id: 'sectors',
        label: 'Sector trends',
        query: 'Which sectors are trending right now?',
      },
      {
        id: 'news',
        label: 'Portfolio news',
        query: 'What recent news could affect my portfolio?',
      },
      {
        id: 'macro',
        label: 'Economic outlook',
        query: 'What key economic data should I be watching?',
      },
    ],
  },
};

/* ─── Component ─── */

interface WaterfallFlowProps {
  categoryId: string;
  onComplete: (query: string) => void;
  onAction?: (action: string, displayLabel: string) => void;
  onCancel: () => void;
}

export default function WaterfallFlow({ categoryId, onComplete, onAction, onCancel }: WaterfallFlowProps) {
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
    [currentStep, onComplete, onAction],
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
                  <div className="text-sm font-medium text-text-primary">{opt.label}</div>
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
