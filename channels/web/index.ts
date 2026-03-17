/**
 * Web channel plugin — entry point.
 */

import type { YojinPlugin } from '../../src/plugins/types.js';
import { buildWebChannel } from './src/channel.js';

export const webPlugin: YojinPlugin = {
  id: 'web',
  name: 'Web',
  description: 'Web UI channel — GraphQL API, chat, SSE streaming',
  register(api) {
    api.registerChannel(buildWebChannel());
  },
};
