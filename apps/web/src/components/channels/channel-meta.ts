export interface ChannelCredentialField {
  key: string;
  label: string;
  placeholder: string;
  helpText?: string;
}

export interface ChannelMeta {
  label: string;
  initials: string;
  color: string;
  description: string;
  setupInstructions: string;
  credentialFields: ChannelCredentialField[];
}

const CHANNEL_META: Record<string, ChannelMeta> = {
  web: {
    label: 'Web Dashboard',
    initials: 'WB',
    color: 'bg-accent-primary/20 text-accent-primary',
    description: 'Built-in web interface',
    setupInstructions: '',
    credentialFields: [],
  },
  telegram: {
    label: 'Telegram',
    initials: 'TG',
    color: 'bg-info/20 text-info',
    description: 'Bot notifications, approval buttons, daily briefings',
    setupInstructions:
      'Open Telegram, message @BotFather, send /newbot and follow the prompts. Paste the bot token below.',
    credentialFields: [
      {
        key: 'TELEGRAM_BOT_TOKEN',
        label: 'Bot Token',
        placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
        helpText: 'From @BotFather',
      },
    ],
  },
  slack: {
    label: 'Slack',
    initials: 'SL',
    color: 'bg-platform-violet/20 text-platform-violet',
    description: 'Workspace messaging and notifications',
    setupInstructions: 'Create a Slack app at api.slack.com/apps, enable Socket Mode, and install to your workspace.',
    credentialFields: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Bot Token',
        placeholder: 'xoxb-...',
        helpText: 'OAuth Bot Token (starts with xoxb-)',
      },
      {
        key: 'SLACK_APP_TOKEN',
        label: 'App Token',
        placeholder: 'xapp-...',
        helpText: 'App-Level Token for Socket Mode (starts with xapp-)',
      },
    ],
  },
};

const DEFAULT_META: ChannelMeta = {
  label: 'Unknown',
  initials: '??',
  color: 'bg-bg-tertiary text-text-muted',
  description: 'Unknown channel',
  setupInstructions: '',
  credentialFields: [],
};

export function getChannelMeta(channelId: string): ChannelMeta {
  return (
    CHANNEL_META[channelId] ?? {
      ...DEFAULT_META,
      label: channelId,
      initials: channelId.slice(0, 2).toUpperCase(),
    }
  );
}

export const KNOWN_CHANNELS = Object.keys(CHANNEL_META);
