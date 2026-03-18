import { useSearchParams } from 'react-router';
import { cn } from '../lib/utils';
import Button from '../components/common/button';

import ActiveRulesView from '../components/skills/active-rules-view.js';
import RuleEditorView from '../components/skills/rule-editor-view.js';

export default function Skills() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = searchParams.get('view') === 'builder' ? 'builder' : 'active';

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="grid grid-cols-3 items-center px-6 pt-6 pb-6">
        <h1 className="text-lg font-semibold text-text-primary">{view === 'active' ? 'Active Skills' : 'Builder'}</h1>

        <div className="flex justify-center">
          <div className="flex gap-1 rounded-full bg-bg-tertiary p-1">
            <button
              onClick={() => setSearchParams({})}
              className={cn(
                'rounded-full px-3 py-1 text-sm transition-colors',
                view === 'active' ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              Active
            </button>
            <button
              onClick={() => setSearchParams({ view: 'builder' })}
              className={cn(
                'rounded-full px-3 py-1 text-sm transition-colors',
                view === 'builder' ? 'bg-bg-hover text-text-primary' : 'text-text-muted hover:text-text-secondary',
              )}
            >
              Builder
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 justify-end">{view === 'builder' && <Button>Save Skill</Button>}</div>
      </header>

      <div className="flex-1 overflow-auto px-6 pb-6">
        {view === 'active' ? <ActiveRulesView /> : <RuleEditorView />}
      </div>
    </div>
  );
}
