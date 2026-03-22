import { useQuery, useMutation } from 'urql';

import {
  ADD_VAULT_SECRET_MUTATION,
  CHANGE_VAULT_PASSPHRASE_MUTATION,
  DELETE_VAULT_SECRET_MUTATION,
  LIST_VAULT_SECRETS_QUERY,
  SET_VAULT_PASSPHRASE_MUTATION,
  UNLOCK_VAULT_MUTATION,
  UPDATE_VAULT_SECRET_MUTATION,
  VAULT_STATUS_QUERY,
} from '../documents.js';
import type {
  AddVaultSecretMutationResult,
  AddVaultSecretVariables,
  ChangeVaultPassphraseMutationResult,
  ChangeVaultPassphraseVariables,
  DeleteVaultSecretMutationResult,
  DeleteVaultSecretVariables,
  ListVaultSecretsQueryResult,
  SetVaultPassphraseMutationResult,
  SetVaultPassphraseVariables,
  UnlockVaultMutationResult,
  UnlockVaultVariables,
  UpdateVaultSecretMutationResult,
  UpdateVaultSecretVariables,
  VaultStatusQueryResult,
} from '../types.js';

/** Vault lock/unlock status and secret count. */
export function useVaultStatus() {
  return useQuery<VaultStatusQueryResult>({ query: VAULT_STATUS_QUERY });
}

/** All vault secret keys with metadata (never values). */
export function useListVaultSecrets() {
  return useQuery<ListVaultSecretsQueryResult>({ query: LIST_VAULT_SECRETS_QUERY });
}

/** Unlock the vault with a passphrase. */
export function useUnlockVault() {
  return useMutation<UnlockVaultMutationResult, UnlockVaultVariables>(UNLOCK_VAULT_MUTATION);
}

/** Set a passphrase on a vault that doesn't have one. */
export function useSetVaultPassphrase() {
  return useMutation<SetVaultPassphraseMutationResult, SetVaultPassphraseVariables>(SET_VAULT_PASSPHRASE_MUTATION);
}

/** Change the vault passphrase. */
export function useChangeVaultPassphrase() {
  return useMutation<ChangeVaultPassphraseMutationResult, ChangeVaultPassphraseVariables>(
    CHANGE_VAULT_PASSPHRASE_MUTATION,
  );
}

/** Add a new secret to the vault. */
export function useAddVaultSecret() {
  return useMutation<AddVaultSecretMutationResult, AddVaultSecretVariables>(ADD_VAULT_SECRET_MUTATION);
}

/** Update an existing secret's value. */
export function useUpdateVaultSecret() {
  return useMutation<UpdateVaultSecretMutationResult, UpdateVaultSecretVariables>(UPDATE_VAULT_SECRET_MUTATION);
}

/** Delete a secret from the vault. */
export function useDeleteVaultSecret() {
  return useMutation<DeleteVaultSecretMutationResult, DeleteVaultSecretVariables>(DELETE_VAULT_SECRET_MUTATION);
}
