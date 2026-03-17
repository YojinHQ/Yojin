import Card from '../components/common/Card';

export default function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Settings</h2>
        <p className="mt-1 text-sm text-slate-400">
          Configure Yojin's AI providers, connected accounts, and system preferences.
        </p>
      </div>

      {/* AI Provider */}
      <Card title="AI Provider">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-slate-400">Provider</label>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              disabled
            >
              <option>Anthropic (Claude)</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-400">Model</label>
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-300 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              disabled
            >
              <option>claude-sonnet-4-20250514</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Connected Accounts */}
      <Card title="Connected Accounts">
        <div className="flex h-24 items-center justify-center">
          <p className="text-sm text-slate-500">
            No investment accounts connected. Account management will be available here.
          </p>
        </div>
      </Card>

      {/* Security */}
      <Card title="Security & Trust">
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-slate-800 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-300">Operational Posture</p>
              <p className="text-xs text-slate-500">Controls rate limits and guard strictness</p>
            </div>
            <select
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-300 focus:border-emerald-500 focus:outline-none"
              disabled
            >
              <option>Local (Strict)</option>
              <option>Standard (Dev)</option>
              <option>Unbounded (Research)</option>
            </select>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-800 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-300">Approval Gate</p>
              <p className="text-xs text-slate-500">Require approval for irreversible actions</p>
            </div>
            <div className="text-sm text-emerald-400">Enabled</div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-800 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-300">PII Redaction</p>
              <p className="text-xs text-slate-500">
                Strip personal data before external API calls
              </p>
            </div>
            <div className="text-sm text-emerald-400">Active</div>
          </div>
        </div>
      </Card>

      {/* Data Sources */}
      <Card title="Data Sources">
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-slate-800 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-300">OpenBB SDK</p>
              <p className="text-xs text-slate-500">Market data, fundamentals, technicals</p>
            </div>
            <div className="text-sm text-slate-500">Configure API keys</div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-slate-800 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-slate-300">Keelson API</p>
              <p className="text-xs text-slate-500">Sentiment analysis and enrichment</p>
            </div>
            <div className="text-sm text-slate-500">Configure</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
