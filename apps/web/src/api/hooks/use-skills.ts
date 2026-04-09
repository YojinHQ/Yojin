import { useCallback } from 'react';
import { useClient, useQuery, useMutation } from 'urql';

import {
  SKILLS_QUERY,
  SKILL_QUERY,
  EXPORT_SKILL_QUERY,
  TOGGLE_SKILL_MUTATION,
  CREATE_SKILL_MUTATION,
  UPDATE_SKILL_MUTATION,
  DELETE_SKILL_MUTATION,
  IMPORT_SKILL_MUTATION,
  STRATEGY_SOURCES_QUERY,
  ADD_STRATEGY_SOURCE_MUTATION,
  REMOVE_STRATEGY_SOURCE_MUTATION,
  TOGGLE_STRATEGY_SOURCE_MUTATION,
  SYNC_STRATEGIES_MUTATION,
  SYNC_STRATEGY_SOURCE_MUTATION,
} from '../documents.js';
import type {
  SkillsQueryResult,
  SkillsQueryVariables,
  SkillQueryResult,
  ExportSkillQueryResult,
  ToggleSkillMutationResult,
  CreateSkillMutationResult,
  UpdateSkillMutationResult,
  DeleteSkillMutationResult,
  ImportSkillMutationResult,
  ImportSkillVariables,
  StrategySourcesQueryResult,
  AddStrategySourceResult,
  RemoveStrategySourceResult,
  ToggleStrategySourceResult,
  SyncStrategiesResult,
  SyncStrategySourceResult,
} from '../types.js';

export function useSkills(variables?: SkillsQueryVariables) {
  return useQuery<SkillsQueryResult, SkillsQueryVariables>({ query: SKILLS_QUERY, variables });
}

export function useSkill(id: string) {
  return useQuery<SkillQueryResult>({ query: SKILL_QUERY, variables: { id }, pause: !id });
}

export function useExportSkill() {
  const client = useClient();
  const exportSkill = useCallback(
    (variables: { id: string }) => client.query<ExportSkillQueryResult>(EXPORT_SKILL_QUERY, variables).toPromise(),
    [client],
  );
  return exportSkill;
}

export function useToggleSkill() {
  return useMutation<ToggleSkillMutationResult>(TOGGLE_SKILL_MUTATION);
}

export function useCreateSkill() {
  return useMutation<CreateSkillMutationResult>(CREATE_SKILL_MUTATION);
}

export function useUpdateSkill() {
  return useMutation<UpdateSkillMutationResult>(UPDATE_SKILL_MUTATION);
}

export function useDeleteSkill() {
  return useMutation<DeleteSkillMutationResult>(DELETE_SKILL_MUTATION);
}

export function useImportSkill() {
  return useMutation<ImportSkillMutationResult, ImportSkillVariables>(IMPORT_SKILL_MUTATION);
}

export function useStrategySources() {
  return useQuery<StrategySourcesQueryResult>({ query: STRATEGY_SOURCES_QUERY });
}

export function useAddStrategySource() {
  return useMutation<AddStrategySourceResult>(ADD_STRATEGY_SOURCE_MUTATION);
}

export function useRemoveStrategySource() {
  return useMutation<RemoveStrategySourceResult>(REMOVE_STRATEGY_SOURCE_MUTATION);
}

export function useToggleStrategySource() {
  return useMutation<ToggleStrategySourceResult>(TOGGLE_STRATEGY_SOURCE_MUTATION);
}

export function useSyncStrategies() {
  return useMutation<SyncStrategiesResult>(SYNC_STRATEGIES_MUTATION);
}

export function useSyncStrategySource() {
  return useMutation<SyncStrategySourceResult>(SYNC_STRATEGY_SOURCE_MUTATION);
}
