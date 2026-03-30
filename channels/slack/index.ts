import type { SlackChannelDeps } from './src/channel.js';
import { buildSlackChannel } from './src/channel.js';
import type { YojinPlugin } from '../../src/plugins/types.js';

export function createSlackPlugin(deps: SlackChannelDeps = {}): YojinPlugin {
  return {
    id: 'slack',
    name: 'Slack',
    description: 'Slack workspace messaging channel',
    register(api) {
      api.registerChannel(buildSlackChannel(deps));
    },
  };
}
