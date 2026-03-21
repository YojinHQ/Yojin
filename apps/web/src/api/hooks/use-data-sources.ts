import { useMutation, useQuery } from 'urql';

import {
  ADD_DATA_SOURCE_MUTATION,
  LIST_DATA_SOURCES_QUERY,
  REMOVE_DATA_SOURCE_MUTATION,
  TOGGLE_DATA_SOURCE_MUTATION,
} from '../documents.js';
import type {
  AddDataSourceMutationResult,
  AddDataSourceVariables,
  ListDataSourcesQueryResult,
  RemoveDataSourceMutationResult,
  RemoveDataSourceVariables,
  ToggleDataSourceMutationResult,
  ToggleDataSourceVariables,
} from '../types.js';

/** All configured data sources. */
export function useListDataSources() {
  return useQuery<ListDataSourcesQueryResult>({ query: LIST_DATA_SOURCES_QUERY });
}

/** Add a new data source. */
export function useAddDataSource() {
  return useMutation<AddDataSourceMutationResult, AddDataSourceVariables>(ADD_DATA_SOURCE_MUTATION);
}

/** Remove a data source. */
export function useRemoveDataSource() {
  return useMutation<RemoveDataSourceMutationResult, RemoveDataSourceVariables>(REMOVE_DATA_SOURCE_MUTATION);
}

/** Enable/disable a data source. */
export function useToggleDataSource() {
  return useMutation<ToggleDataSourceMutationResult, ToggleDataSourceVariables>(TOGGLE_DATA_SOURCE_MUTATION);
}
