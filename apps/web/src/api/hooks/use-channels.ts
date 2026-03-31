import { useMutation, useQuery, useSubscription } from 'urql';

import {
  CANCEL_CHANNEL_PAIRING_MUTATION,
  CONNECT_CHANNEL_MUTATION,
  DISCONNECT_CHANNEL_MUTATION,
  INITIATE_CHANNEL_PAIRING_MUTATION,
  LIST_CHANNELS_QUERY,
  NOTIFICATION_PREFERENCES_QUERY,
  ON_CHANNEL_PAIRING_SUBSCRIPTION,
  SAVE_NOTIFICATION_PREFERENCES_MUTATION,
  VALIDATE_CHANNEL_TOKEN_MUTATION,
} from '../documents.js';
import type { Channel, ChannelResult, NotificationPreferences, PairingEvent, PairingResult } from '../types.js';

export function useListChannels() {
  return useQuery<{ listChannels: Channel[] }>({
    query: LIST_CHANNELS_QUERY,
    requestPolicy: 'network-only',
  });
}

export function useConnectChannel() {
  return useMutation<{ connectChannel: ChannelResult }, { id: string; credentials: { key: string; value: string }[] }>(
    CONNECT_CHANNEL_MUTATION,
  );
}

export function useDisconnectChannel() {
  return useMutation<{ disconnectChannel: ChannelResult }, { id: string }>(DISCONNECT_CHANNEL_MUTATION);
}

export function useValidateChannelToken() {
  return useMutation<
    { validateChannelToken: ChannelResult },
    { id: string; credentials: { key: string; value: string }[] }
  >(VALIDATE_CHANNEL_TOKEN_MUTATION);
}

export function useNotificationPreferences() {
  return useQuery<{ notificationPreferences: NotificationPreferences[] }>({
    query: NOTIFICATION_PREFERENCES_QUERY,
    requestPolicy: 'network-only',
  });
}

export function useSaveNotificationPreferences() {
  return useMutation<{ saveNotificationPreferences: boolean }, { channelId: string; enabledTypes: string[] }>(
    SAVE_NOTIFICATION_PREFERENCES_MUTATION,
  );
}

export function useInitiateChannelPairing() {
  return useMutation<{ initiateChannelPairing: PairingResult }, { id: string }>(INITIATE_CHANNEL_PAIRING_MUTATION);
}

export function useCancelChannelPairing() {
  return useMutation<{ cancelChannelPairing: ChannelResult }, { id: string }>(CANCEL_CHANNEL_PAIRING_MUTATION);
}

export function useChannelPairing(channelId: string | null) {
  return useSubscription<{ onChannelPairing: PairingEvent }, { onChannelPairing: PairingEvent }, { id: string }>({
    query: ON_CHANNEL_PAIRING_SUBSCRIPTION,
    variables: { id: channelId ?? '' },
    pause: !channelId,
  });
}
