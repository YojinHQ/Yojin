import { useState } from 'react';

import Button from '../components/common/button';
import ActiveRulesView from '../components/skills/active-rules-view.js';
import ImportSkillModal from '../components/skills/import-skill-modal.js';
import SkillEditorModal from '../components/skills/skill-editor-modal.js';
import { StrategySources } from '../components/skills/strategy-sources.js';

export default function Skills() {
  const [importOpen, setImportOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);

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
              setEditorKey((k) => k + 1);
              setEditorOpen(true);
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

      <ImportSkillModal open={importOpen} onClose={() => setImportOpen(false)} />
      <SkillEditorModal key={editorKey} open={editorOpen} onClose={() => setEditorOpen(false)} />
    </div>
  );
}
