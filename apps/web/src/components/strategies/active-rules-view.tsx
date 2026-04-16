import { useMemo, useState } from 'react';

import StrategyCard from './strategy-card.js';
import StrategyDetailModal from './strategy-detail-modal.js';
import Spinner from '../common/spinner.js';
import Modal from '../common/modal.js';
import { useStrategies, useToggleStrategy } from '../../api/hooks/index.js';
import type { Strategy, StrategyCategory } from './types.js';
import { cn } from '../../lib/utils.js';

const STRATEGY_DISCLAIMER_ACK_KEY = 'yojin-strategy-disclaimer-ack-v1';

const CATEGORY_FILTERS: Array<{ label: string; value: StrategyCategory | 'ALL' }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Market', value: 'MARKET' },
  { label: 'Risk', value: 'RISK' },
  { label: 'Portfolio', value: 'PORTFOLIO' },
  { label: 'Research', value: 'RESEARCH' },
];

export default function ActiveRulesView() {
  const [result] = useStrategies();
  const [, toggleStrategy] = useToggleStrategy();
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<StrategyCategory | 'ALL'>('ALL');
  const [pendingActivation, setPendingActivation] = useState<Strategy | null>(null);
  const [disclaimerAcked, setDisclaimerAcked] = useState(false);

  const strategies = useMemo(() => result.data?.strategies ?? [], [result.data?.strategies]);

  const filtered = useMemo(() => {
    let list = strategies;
    if (categoryFilter !== 'ALL') {
      list = list.filter((s) => s.category === categoryFilter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.style.toLowerCase().includes(q),
      );
    }
    return list;
  }, [strategies, categoryFilter, search]);

  const active = filtered.filter((s) => s.active);
  const available = filtered.filter((s) => !s.active);

  async function activate(id: string) {
    const res = await toggleStrategy({ id, active: true });
    if (res.error) setToggleError(res.error.message);
  }

  async function handleToggle(id: string, newActive: boolean) {
    setToggleError(null);
    if (!newActive) {
      const res = await toggleStrategy({ id, active: false });
      if (res.error) setToggleError(res.error.message);
      return;
    }
    const alreadyAcked = typeof window !== 'undefined' && !!window.localStorage.getItem(STRATEGY_DISCLAIMER_ACK_KEY);
    if (alreadyAcked) {
      await activate(id);
      return;
    }
    const strategy = strategies.find((s) => s.id === id) ?? null;
    setDisclaimerAcked(false);
    setPendingActivation(strategy);
  }

  async function confirmActivation() {
    if (!pendingActivation || !disclaimerAcked) return;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STRATEGY_DISCLAIMER_ACK_KEY, new Date().toISOString());
    }
    const id = pendingActivation.id;
    setPendingActivation(null);
    await activate(id);
  }

  if (result.fetching) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner label="Loading strategies..." />
      </div>
    );
  }

  if (result.error) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-error">Failed to load strategies. Please try again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="relative flex-1 max-w-xs">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search strategies..."
            className="w-full rounded-lg border border-border bg-bg-tertiary py-1.5 pl-8 pr-3 text-xs text-text-primary placeholder:text-text-muted outline-none transition-colors focus-visible:border-accent-primary focus-visible:ring-2 focus-visible:ring-accent-primary/30"
          />
        </div>

        <div className="flex items-center gap-1">
          {CATEGORY_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setCategoryFilter(f.value)}
              className={cn(
                'rounded-md px-2.5 py-1 text-2xs font-medium transition-colors',
                categoryFilter === f.value
                  ? 'bg-accent-primary/15 text-accent-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-hover',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {toggleError && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">{toggleError}</div>
      )}

      {active.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-text-secondary mb-3">Active ({active.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {active.map((strategy) => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                onToggle={handleToggle}
                onClick={setSelectedStrategy}
              />
            ))}
          </div>
        </section>
      )}

      {available.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-text-secondary mb-3">Available ({available.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {available.map((strategy) => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                onToggle={handleToggle}
                onClick={setSelectedStrategy}
              />
            ))}
          </div>
        </section>
      )}

      {filtered.length === 0 && !result.fetching && (
        <div className="text-center py-20 text-text-muted">
          <p className="text-sm">
            {strategies.length === 0 ? 'No strategies yet.' : 'No strategies match your filters.'}
          </p>
        </div>
      )}

      {selectedStrategy && (
        <StrategyDetailModal
          open={!!selectedStrategy}
          strategyId={selectedStrategy.id}
          onClose={() => setSelectedStrategy(null)}
        />
      )}

      <Modal
        open={!!pendingActivation}
        onClose={() => setPendingActivation(null)}
        title="Enable strategy — not financial advice"
        maxWidth="max-w-xl"
      >
        <div className="space-y-4 text-sm text-text-secondary">
          <p>
            You&rsquo;re about to enable{' '}
            <span className="font-semibold text-text-primary">{pendingActivation?.name}</span>. Once active, it can
            generate BUY/SELL action proposals against your portfolio.
          </p>
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-text-secondary">
            <p className="mb-2 font-semibold text-warning">This is not financial advice.</p>
            <p>
              Strategies are automated heuristics, not recommendations from a licensed adviser. Outputs may be wrong,
              incomplete, or out of date. You are solely responsible for every trade you approve. No order is placed
              without your explicit confirmation. Past performance does not predict future results.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-xs text-text-secondary">
            <input
              type="checkbox"
              checked={disclaimerAcked}
              onChange={(e) => setDisclaimerAcked(e.target.checked)}
              className="mt-0.5 h-4 w-4 cursor-pointer accent-accent-primary"
            />
            <span>
              I understand that Yojin does not provide financial advice and that I&rsquo;m responsible for my own
              investment decisions.
            </span>
          </label>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPendingActivation(null)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!disclaimerAcked}
              onClick={confirmActivation}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                disclaimerAcked
                  ? 'bg-accent-primary text-white hover:opacity-90'
                  : 'cursor-not-allowed bg-bg-tertiary text-text-muted',
              )}
            >
              Enable strategy
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
