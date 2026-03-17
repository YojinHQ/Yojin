interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export default function Card({ title, children, className = '' }: CardProps) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900 p-5 ${className}`}>
      {title && <h3 className="mb-4 text-sm font-medium text-slate-400">{title}</h3>}
      {children}
    </div>
  );
}
