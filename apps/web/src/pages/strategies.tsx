import { useState } from 'react';

import Button from '../components/common/button';
import ActiveRulesView from '../components/strategies/active-rules-view.js';
import ImportStrategyModal from '../components/strategies/import-strategy-modal.js';
import { StrategyStudio } from '../components/strategies/strategy-studio.js';
import { StrategySources } from '../components/strategies/strategy-sources.js';

export default function Strategies() {
  const [importOpen, setImportOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [studioKey, setStudioKey] = useState(0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between px-6 pt-6 pb-6">
        <h1 className="text-lg font-semibold text-text-primary">Strategies</h1>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            Import
          </Button>
          <Button
            onClick={() => {
              setStudioKey((k) => k + 1);
              setStudioOpen(true);
            }}
          >
            Create
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <ActiveRulesView />
        <div className="mt-8">
          <StrategySources />
        </div>
      </div>

      <ImportStrategyModal open={importOpen} onClose={() => setImportOpen(false)} />
      <StrategyStudio key={studioKey} open={studioOpen} onClose={() => setStudioOpen(false)} />
    </div>
  );
}
