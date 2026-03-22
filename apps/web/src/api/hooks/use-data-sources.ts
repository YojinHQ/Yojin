import { useMutation, useQuery } from 'urql';

import {
  ADD_DATA_SOURCE_MUTATION,
  CHECK_CLI_COMMANDS_QUERY,
  FETCH_DATA_SOURCE_MUTATION,
  LIST_DATA_SOURCES_QUERY,
  REMOVE_DATA_SOURCE_MUTATION,
  SIGNALS_QUERY,
  TOGGLE_DATA_SOURCE_MUTATION,
} from '../documents.js';
import type {
  AddDataSourceMutationResult,
  AddDataSourceVariables,
  CheckCliCommandsQueryResult,
  FetchDataSourceMutationResult,
  FetchDataSourceVariables,
  ListDataSourcesQueryResult,
  RemoveDataSourceMutationResult,
  RemoveDataSourceVariables,
  SignalsQueryResult,
  SignalsVariables,
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

/** Trigger a fetch on a data source. */
export function useFetchDataSource() {
  return useMutation<FetchDataSourceMutationResult, FetchDataSourceVariables>(FETCH_DATA_SOURCE_MUTATION);
}

/** Query stored signals. */
export function useSignals(variables: SignalsVariables = {}) {
  return useQuery<SignalsQueryResult, SignalsVariables>({ query: SIGNALS_QUERY, variables });
}

/** Check which CLI commands are available on the system. */
export function useCheckCliCommands(commands: string[]) {
  return useQuery<CheckCliCommandsQueryResult>({
    query: CHECK_CLI_COMMANDS_QUERY,
    variables: { commands },
    pause: commands.length === 0,
  });
}
