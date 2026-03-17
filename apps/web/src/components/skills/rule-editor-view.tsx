export default function RuleEditorView() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-headline text-lg text-text-primary">Rule Builder</h2>
        <button className="bg-accent-primary hover:bg-accent-secondary text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          Save Rule
        </button>
      </div>

      {/* Canvas area */}
      <div className="bg-bg-card border border-border rounded-xl p-8 min-h-[500px] flex items-center justify-center">
        <div className="flex items-center gap-6">
          {/* Trigger node */}
          <div className="bg-bg-tertiary border border-border rounded-xl p-6 w-[200px]">
            <div className="text-xs text-accent-primary font-medium uppercase tracking-wider mb-2">Trigger</div>
            <div className="text-text-primary font-medium">Price Change</div>
            <div className="text-text-muted text-sm mt-1">When price moves &gt; 5%</div>
          </div>

          {/* Arrow */}
          <svg
            className="w-8 h-8 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>

          {/* Condition node */}
          <div className="bg-bg-tertiary border border-border rounded-xl p-6 w-[200px]">
            <div className="text-xs text-warning font-medium uppercase tracking-wider mb-2">Condition</div>
            <div className="text-text-primary font-medium">Position Check</div>
            <div className="text-text-muted text-sm mt-1">If position &gt; $10,000</div>
          </div>

          {/* Arrow */}
          <svg
            className="w-8 h-8 text-text-muted"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
          </svg>

          {/* Action node */}
          <div className="bg-bg-tertiary border border-border rounded-xl p-6 w-[200px]">
            <div className="text-xs text-success font-medium uppercase tracking-wider mb-2">Action</div>
            <div className="text-text-primary font-medium">Send Alert</div>
            <div className="text-text-muted text-sm mt-1">Notify via Slack + Email</div>
          </div>
        </div>
      </div>

      <p className="text-text-muted text-sm text-center">
        Drag and drop to build custom automation rules (coming soon)
      </p>
    </div>
  );
}
