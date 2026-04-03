export interface QuickAction {
  id: string;
  label: string;
  prompt: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'portfolio', label: 'Portfolio', prompt: 'Show my portfolio summary' },
  { id: 'risk', label: 'Risk & Exposure', prompt: 'Analyze my risk and exposure' },
  { id: 'positions', label: 'Positions', prompt: 'Show my current positions' },
  { id: 'trends', label: 'Trends', prompt: 'What are the key trends in my portfolio?' },
];
