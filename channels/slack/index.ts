/**
 * Slack channel plugin — entry point.
 */

import type { YojinPlugin } from "../../src/plugins/types.js";
import { buildSlackChannel } from "./src/channel.js";

export const slackPlugin: YojinPlugin = {
  id: "slack",
  name: "Slack",
  description: "Slack workspace messaging channel",
  register(api) {
    api.registerChannel(buildSlackChannel());
  },
};
