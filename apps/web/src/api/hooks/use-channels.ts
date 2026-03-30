import { useMutation, useQuery } from 'urql';

import {
  CONNECT_CHANNEL_MUTATION,
  DISCONNECT_CHANNEL_MUTATION,
  LIST_CHANNELS_QUERY,
  NOTIFICATION_PREFERENCES_QUERY,
  SAVE_NOTIFICATION_PREFERENCES_MUTATION,
  VALIDATE_CHANNEL_TOKEN_MUTATION,
} from '../documents.js';
import type { Channel, ChannelResult, NotificationPreferences } from '../types.js';

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
