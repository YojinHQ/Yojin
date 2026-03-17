export default function SkillCardAdd({ onClick }: { onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="border-2 border-dashed border-border rounded-xl p-5 flex flex-col items-center justify-center gap-2 text-text-muted hover:border-border-light hover:text-text-secondary transition-colors min-h-[140px]"
    >
      <svg
        className="w-8 h-8"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      <span className="text-sm">Create New Rule</span>
    </button>
  );
}
