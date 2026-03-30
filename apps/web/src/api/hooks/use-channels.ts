import { useMutation, useQuery } from 'urql';

import {
  CONNECT_CHANNEL_MUTATION,
  DISCONNECT_CHANNEL_MUTATION,
  LIST_CHANNELS_QUERY,
  VALIDATE_CHANNEL_TOKEN_MUTATION,
} from '../documents.js';
import type { Channel, ChannelResult } from '../types.js';

export function useListChannels() {
  return useQuery<{ listChannels: Channel[] }>({ query: LIST_CHANNELS_QUERY });
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
