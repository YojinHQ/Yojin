/**
 * Web channel plugin — entry point.
 */

import { buildWebChannel } from './src/channel.js';
import type { YojinPlugin } from '../../src/plugins/types.js';

export const webPlugin: YojinPlugin = {
  id: 'web',
  name: 'Web',
  description: 'Web UI channel — GraphQL API, chat, SSE streaming',
  register(api) {
    api.registerChannel(buildWebChannel());
  },
};
