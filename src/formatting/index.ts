export { chunkMessage } from './chunk-message.js';
export { escapeHtml } from './escape-html.js';

const TRIGGER_STRENGTH_LABELS: Record<string, string> = {
  WEAK: 'Weak',
  MODERATE: 'Moderate',
  STRONG: 'Strong',
  EXTREME: 'Extreme',
};

/** Title-case a trigger strength enum value (e.g. 'STRONG' → 'Strong'). */
export function formatTriggerStrength(strength: string): string {
  return TRIGGER_STRENGTH_LABELS[strength] ?? strength;
}
