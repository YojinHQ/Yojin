import type { Action } from '../actions/types.js';

export { chunkMessage } from './chunk-message.js';
export { escapeHtml } from './escape-html.js';

/**
 * Canonical one-line headline for an Action across channels.
 *
 * The LLM is instructed to emit `what` as `VERDICT TICKER — catalyst`, but we
 * can't trust it to always comply. When `what` doesn't already lead with the
 * verdict, rebuild the headline from the structured `verdict` + `tickers[0]`
 * fields so the notification never loses the side/symbol.
 */
export function canonicalActionHeadline(action: Pick<Action, 'verdict' | 'tickers' | 'what'>): string {
  const what = action.what.trim();
  if (what.toUpperCase().startsWith(action.verdict.toUpperCase())) {
    return what;
  }
  const ticker = action.tickers[0];
  const prefix = ticker ? `${action.verdict} ${ticker}` : action.verdict;
  return what ? `${prefix} — ${what}` : prefix;
}
