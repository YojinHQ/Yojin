import type { WhatsAppChannelDeps } from './src/channel.js';
import { buildWhatsAppChannel } from './src/channel.js';
import type { YojinPlugin } from '../../src/plugins/types.js';

export type { WhatsAppChannelDeps };

export function createWhatsAppPlugin(deps: WhatsAppChannelDeps = {}): YojinPlugin {
  return {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'WhatsApp messaging channel via Baileys',
    register(api) {
      api.registerChannel(buildWhatsAppChannel(deps));
    },
  };
}
