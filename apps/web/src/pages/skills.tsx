import { useSearchParams } from 'react-router';
import { cn } from '../lib/utils';

import ActiveRulesView from '../components/skills/active-rules-view.js';
import RuleEditorView from '../components/skills/rule-editor-view.js';

export default function Skills() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'builder' ? 'builder' : 'active';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border bg-bg-secondary px-4 py-2">
        <h1 className="text-sm font-medium tracking-wide text-text-secondary uppercase min-w-[200px]">Skills</h1>

        <div className="flex gap-1 rounded-full bg-bg-tertiary p-1">
          <button
            onClick={() => setSearchParams({})}
            className={cn(
              'rounded-full px-4 py-1 text-sm transition-colors',
              view === 'active' ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-secondary',
            )}
          >
            Active Skills
          </button>
          <button
            onClick={() => setSearchParams({ view: 'builder' })}
            className={cn(
              'rounded-full px-4 py-1 text-sm transition-colors',
              view === 'builder' ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-secondary',
            )}
          >
            Builder
          </button>
        </div>

        <div className="flex items-center gap-2 min-w-[200px] justify-end">
          <button className="p-2 rounded-lg border border-border text-text-muted hover:text-text-secondary hover:border-border-light transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"
              />
            </svg>
          </button>
          <button className="p-2 rounded-lg border border-border text-text-muted hover:text-text-secondary hover:border-border-light transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto p-6">{view === 'active' ? <ActiveRulesView /> : <RuleEditorView />}</div>
    </div>
  );
}
