import { useQuery, useMutation } from 'urql';

import { DEVICE_INFO_QUERY, CLEAR_APP_DATA_MUTATION } from '../documents.js';
import type { DeviceInfoQueryResult } from '../types.js';

export function useDeviceInfo() {
  return useQuery<DeviceInfoQueryResult>({ query: DEVICE_INFO_QUERY });
}

export function useClearAppData() {
  return useMutation<{ clearAppData: boolean }>(CLEAR_APP_DATA_MUTATION);
}
