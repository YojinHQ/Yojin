import { useState } from 'react';
import { useQuery } from 'urql';
import Card from '../common/card';
import { GateCard } from '../common/feature-gate';
import { ChannelCard } from '../channels/channel-card';
import { ConnectChannelModal } from '../channels/connect-channel-modal';
import { useListChannels, useDisconnectChannel } from '../../api/hooks/use-channels';
import { ONBOARDING_STATUS_QUERY } from '../../api/documents';
import type { OnboardingStatusQueryResult } from '../../api/types';

export function DeliveryChannelsCard() {
  const [{ data: statusData }] = useQuery<OnboardingStatusQueryResult>({
    query: ONBOARDING_STATUS_QUERY,
  });
  const jintelConfigured = statusData?.onboardingStatus?.jintelConfigured ?? false;

  return (
    <div className="relative">
      <Card className="overflow-hidden p-0">
        {/* Header */}
        <div className="flex items-center gap-4 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-primary/10">
            <ChannelIcon />
          </div>
          <div>
            <h2 className="font-headline text-lg text-text-primary">Delivery Channels</h2>
            <p className="text-sm text-text-muted">
              Connect messaging channels for notifications, approvals, and daily briefings.
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="border-t border-border px-5 py-4">
          <ChannelsSection />
        </div>
      </Card>

      {!jintelConfigured && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-bg-primary/70 backdrop-blur-[3px]">
          <GateCard
            requires="jintel"
            subtitle="Jintel is free to use. Connect it to unlock live market data and analytics."
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChannelsSection (internal)
// ---------------------------------------------------------------------------

function ChannelsSection() {
  const [result, reexecute] = useListChannels();
  const [, disconnectChannel] = useDisconnectChannel();
  const [connectModalChannel, setConnectModalChannel] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const channels = result.data?.listChannels ?? [];

  const handleDisconnect = async (channelId: string) => {
    setDisconnectingId(channelId);
    const res = await disconnectChannel({ id: channelId });
    setDisconnectingId(null);
    if (res.data?.disconnectChannel.success) {
      reexecute({ requestPolicy: 'network-only' });
    }
  };

  const handleConnected = () => {
    setConnectModalChannel(null);
    reexecute({ requestPolicy: 'network-only' });
  };

  if (result.fetching && channels.length === 0) {
    return <p className="text-sm text-text-muted">Loading channels...</p>;
  }

  if (result.error) {
    return <p className="text-sm text-error">Failed to load channels.</p>;
  }

  return (
    <>
      <div className="space-y-3">
        {channels.map((channel) => (
          <ChannelCard
            key={channel.id}
            channel={channel}
            onConnect={setConnectModalChannel}
            onDisconnect={handleDisconnect}
            disconnecting={disconnectingId === channel.id}
          />
        ))}
      </div>

      <ConnectChannelModal
        open={connectModalChannel !== null}
        channelId={connectModalChannel}
        onClose={() => setConnectModalChannel(null)}
        onConnected={handleConnected}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function ChannelIcon() {
  return (
    <svg
      className="h-5 w-5 text-accent-primary"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 0 1 1.037-.443 48.282 48.282 0 0 0 5.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0 0 12 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018Z"
      />
    </svg>
  );
}
