/** A predefined quick-action shortcut displayed in channel UIs (Telegram keyboard, Slack Home tab, WhatsApp menu). */
export interface QuickAction {
  /** Stable identifier used as callback data (e.g. `quick:portfolio`). */
  id: string;
  /** Human-readable button label shown in the channel UI. */
  label: string;
  /** Full prompt dispatched to the agent when the action is selected. */
  prompt: string;
}

/** Predefined quick actions surfaced to users across all supported channels. */
export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'portfolio', label: 'Portfolio', prompt: 'Show my portfolio summary' },
  { id: 'risk', label: 'Risk & Exposure', prompt: 'Analyze my risk and exposure' },
  { id: 'positions', label: 'Positions', prompt: 'Show my current positions' },
  { id: 'trends', label: 'Trends', prompt: 'What are the key trends in my portfolio?' },
];
