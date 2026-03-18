export default function MorningBriefing() {
  return (
    <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg, #FF5A5E, #B30004)' }}>
      <div className="mb-4 flex items-center gap-2">
        <img src="/yojin_icon_white.png" alt="" className="h-6 w-6" />
        <span className="text-sm font-medium opacity-90">Yojin Morning Briefing</span>
      </div>
      <h3 className="font-headline mb-4 text-xl">Good morning! Here's your portfolio update.</h3>
      <div className="mb-4 grid grid-cols-4 gap-4">
        <div>
          <div className="text-2xl font-bold">3</div>
          <div className="text-sm opacity-75">Actions Required</div>
        </div>
        <div>
          <div className="text-2xl font-bold">5</div>
          <div className="text-sm opacity-75">Stock Alerts</div>
        </div>
        <div>
          <div className="text-2xl font-bold">8</div>
          <div className="text-sm opacity-75">New Insights</div>
        </div>
        <div>
          <div className="text-2xl font-bold">23.4%</div>
          <div className="text-sm opacity-75">Avg Margin</div>
        </div>
      </div>
      <button className="rounded-lg bg-white/20 px-4 py-2 text-sm text-white transition-colors hover:bg-white/30">
        View Full Briefing
      </button>
    </div>
  );
}
