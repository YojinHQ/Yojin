import type { TelegramChannelDeps } from './src/channel.js';
import { buildTelegramChannel } from './src/channel.js';
import type { YojinPlugin } from '../../src/plugins/types.js';

export function createTelegramPlugin(deps: TelegramChannelDeps = {}): YojinPlugin {
  return {
    id: 'telegram',
    name: 'Telegram',
    description: 'Telegram bot messaging channel with push notifications',
    register(api) {
      api.registerChannel(buildTelegramChannel(deps));
    },
  };
}
