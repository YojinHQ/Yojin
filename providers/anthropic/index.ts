/**
 * Anthropic provider plugin — entry point.
 */

import type { YojinPlugin } from '../../src/plugins/types.js';
import { buildAnthropicProvider } from './src/provider.js';

export const anthropicPlugin: YojinPlugin = {
  id: 'anthropic',
  name: 'Anthropic',
  description: 'Claude models by Anthropic',
  register(api) {
    api.registerProvider(buildAnthropicProvider());
  },
};
