import { useSearchParams } from 'react-router';

import ActiveRulesView from '../components/skills/active-rules-view.js';
import RuleEditorView from '../components/skills/rule-editor-view.js';

export default function Skills() {
  const [searchParams] = useSearchParams();
  const view = searchParams.get('view') === 'builder' ? 'builder' : 'active';

  return <div className="flex-1 overflow-auto p-6">{view === 'active' ? <ActiveRulesView /> : <RuleEditorView />}</div>;
}
