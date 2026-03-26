/** Collect all signal IDs referenced by an insight report (position + portfolio level). */
export function collectInsightSignalIds(
  report:
    | {
        positions: { keySignals: { signalId: string }[]; allSignalIds?: string[] }[];
        portfolio: {
          topRisks: { signalIds: string[] }[];
          topOpportunities: { signalIds: string[] }[];
          actionItems: { signalIds: string[] }[];
        };
      }
    | null
    | undefined,
): Set<string> {
  if (!report) return new Set<string>();
  const ids = new Set<string>();
  // Position-level: all signals for each ticker (deterministic, not LLM-selected)
  for (const pos of report.positions) {
    for (const id of pos.allSignalIds ?? []) {
      ids.add(id);
    }
    // Fallback: keySignals for reports created before allSignalIds was added
    for (const sig of pos.keySignals) {
      ids.add(sig.signalId);
    }
  }
  // Portfolio-level signal references (risks, opportunities, action items)
  const portfolioItems = [
    ...report.portfolio.topRisks,
    ...report.portfolio.topOpportunities,
    ...report.portfolio.actionItems,
  ];
  for (const item of portfolioItems) {
    for (const id of item.signalIds) {
      ids.add(id);
    }
  }
  return ids;
}
