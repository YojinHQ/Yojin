import type { ReactNode } from 'react';
import { BarChart3, DollarSign, Briefcase, Activity, Sparkles } from 'lucide-react';

interface QuerySuggestion {
  id: string;
  icon: ReactNode;
  label: string;
  query: string;
}

interface QueryBuilderProps {
  suggestions?: QuerySuggestion[];
  onSelect: (id: string) => void;
}

const defaultSuggestions: QuerySuggestion[] = [
  {
    id: 'portfolio',
    icon: <BarChart3 className="h-4 w-4" />,
    label: 'Portfolio',
    query: 'How is my portfolio performing today?',
  },
  {
    id: 'risk',
    icon: <DollarSign className="h-4 w-4" />,
    label: 'Risk & Exposure',
    query: 'Analyze my current risk exposure',
  },
  {
    id: 'positions',
    icon: <Briefcase className="h-4 w-4" />,
    label: 'Positions',
    query: 'Show me my top performing positions',
  },
  {
    id: 'trends',
    icon: <Activity className="h-4 w-4" />,
    label: 'Trends',
    query: 'What market trends should I watch?',
  },
];

export default function QueryBuilder({ suggestions = defaultSuggestions, onSelect }: QueryBuilderProps) {
  return (
    <div>
      {/* Header with star icon */}
      <div className="my-6 flex items-center justify-center gap-2.5">
        <Sparkles className="h-5 w-5 text-accent-primary" />
        <h2 className="text-base font-semibold text-text-primary">Let&apos;s knock something off your list</h2>
      </div>

      {/* Suggestion grid */}
      <div className="grid grid-cols-2 gap-2">
        {suggestions.map((s) => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/60 bg-bg-secondary px-3.5 py-2.5 text-left transition-all hover:border-border-light hover:bg-bg-hover"
          >
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-bg-tertiary text-text-muted">
              {s.icon}
            </div>
            <span className="text-xs font-medium text-text-primary">{s.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
