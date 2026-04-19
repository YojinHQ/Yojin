/** Render `"{name} ({ticker})"` so single-word names like "Strategy" can't be read as generic nouns. */
export function formatAssetLabel(entityName: string | null | undefined, ticker: string): string {
  if (!entityName) return ticker;
  if (entityName.toUpperCase() === ticker.toUpperCase()) return ticker;
  return `${entityName} (${ticker})`;
}
