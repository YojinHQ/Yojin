import { useQuery } from 'urql';

import { DEVICE_INFO_QUERY } from '../documents.js';
import type { DeviceInfoQueryResult } from '../types.js';

export function useDeviceInfo() {
  return useQuery<DeviceInfoQueryResult>({ query: DEVICE_INFO_QUERY });
}
