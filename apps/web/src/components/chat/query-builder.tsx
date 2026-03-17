export default function QueryBuilder({ onSelect }: { onSelect: (query: string) => void }) {
  const suggestions = [
    {
      icon: '\u{1F4CA}',
      title: 'Portfolio',
      description: 'How is my portfolio performing today?',
      query: 'How is my portfolio performing today?',
    },
    {
      icon: '\u26A1',
      title: 'Risk & Exposure',
      description: 'Analyze my current risk exposure',
      query: 'Analyze my current risk exposure',
    },
    {
      icon: '\u{1F4C8}',
      title: 'Positions',
      description: 'Show me my top performing positions',
      query: 'Show me my top performing positions',
    },
    {
      icon: '\u{1F50D}',
      title: 'Trends',
      description: 'What market trends should I watch?',
      query: 'What market trends should I watch?',
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-text-secondary text-center text-sm">Let's knock something off your list</p>
      <div className="grid grid-cols-2 gap-3">
        {suggestions.map((s) => (
          <button
            key={s.title}
            onClick={() => onSelect(s.query)}
            className="bg-bg-card border-border hover:border-border-light hover:bg-bg-hover rounded-xl border p-4 text-left transition-colors"
          >
            <div className="mb-1 text-lg">{s.icon}</div>
            <div className="text-text-primary text-sm font-medium">{s.title}</div>
            <div className="text-text-muted mt-1 text-xs">{s.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
