export default function SkillCardAdd({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group border-2 border-dashed border-border rounded-xl p-5 flex flex-col items-center justify-center gap-3 text-text-muted hover:border-accent-primary hover:shadow-[0_0_16px_var(--color-accent-glow)] transition-all min-h-[180px] cursor-pointer"
    >
      <div className="w-11 h-11 rounded-xl bg-bg-hover flex items-center justify-center transition-colors group-hover:bg-accent-primary/20 group-hover:text-accent-primary">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
        </svg>
      </div>
      <span className="text-sm group-hover:text-accent-primary transition-colors">Create New Skill</span>
    </button>
  );
}
