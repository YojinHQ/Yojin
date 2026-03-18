/**
 * Anthropic provider plugin — entry point.
 */

import { buildAnthropicProvider } from './src/provider.js';
import type { YojinPlugin } from '../../src/plugins/types.js';

export const anthropicPlugin: YojinPlugin = {
  id: 'anthropic',
  name: 'Anthropic',
  description: 'Claude models by Anthropic',
  register(api) {
    api.registerProvider(buildAnthropicProvider());
  },
};
