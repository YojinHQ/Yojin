/**
 * Slack channel plugin — entry point.
 */

import { buildSlackChannel } from './src/channel.js';
import type { YojinPlugin } from '../../src/plugins/types.js';

export const slackPlugin: YojinPlugin = {
  id: 'slack',
  name: 'Slack',
  description: 'Slack workspace messaging channel',
  register(api) {
    api.registerChannel(buildSlackChannel());
  },
};
