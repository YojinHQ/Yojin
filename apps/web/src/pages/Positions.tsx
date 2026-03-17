import PositionTable from '../components/portfolio/PositionTable';

export default function Positions() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Positions</h2>
          <p className="mt-1 text-sm text-slate-400">
            All portfolio positions across connected accounts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
            <option value="all">All Accounts</option>
          </select>
          <select className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
            <option value="all">All Asset Classes</option>
            <option value="equity">Equities</option>
            <option value="crypto">Crypto</option>
            <option value="cash">Cash</option>
          </select>
        </div>
      </div>

      <PositionTable />
    </div>
  );
}
