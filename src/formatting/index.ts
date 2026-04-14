export { chunkMessage } from './chunk-message.js';
export { escapeHtml } from './escape-html.js';

/** Title-case a SCREAMING_SNAKE trigger strength enum value (e.g. 'STRONG' → 'Strong'). */
export function formatTriggerStrength(strength: string): string {
  return strength.charAt(0) + strength.slice(1).toLowerCase();
}
