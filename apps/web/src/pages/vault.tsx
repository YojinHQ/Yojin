import { useState, useCallback } from 'react';
import { cn } from '../lib/utils';
import Card from '../components/common/card';
import Button from '../components/common/button';
import Input from '../components/common/input';
import Modal from '../components/common/modal';
import {
  useVaultStatus,
  useListVaultSecrets,
  useUnlockVault,
  useSetVaultPassphrase,
  useChangeVaultPassphrase,
  useAddVaultSecret,
  useUpdateVaultSecret,
  useDeleteVaultSecret,
} from '../api/hooks';
import type { VaultSecret } from '../api/types';

/** Vault management — single unified card embedded in the Profile page. */
export function VaultSection() {
  const [statusResult, reexecuteStatus] = useVaultStatus();
  const [secretsResult, reexecuteSecrets] = useListVaultSecrets();

  const isUnlocked = statusResult.data?.vaultStatus.isUnlocked ?? false;
  const hasPassphrase = statusResult.data?.vaultStatus.hasPassphrase ?? false;
  const secrets = secretsResult.data?.listVaultSecrets ?? [];
  const loading = statusResult.fetching || secretsResult.fetching;

  const refresh = useCallback(() => {
    reexecuteStatus({ requestPolicy: 'network-only' });
    reexecuteSecrets({ requestPolicy: 'network-only' });
  }, [reexecuteStatus, reexecuteSecrets]);

  return (
    <Card className="overflow-hidden p-0">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl',
              isUnlocked ? 'bg-success/10' : 'bg-warning/10',
            )}
          >
            {isUnlocked ? <UnlockedIcon /> : <LockedIcon />}
          </div>
          <div>
            <h2 className="font-headline text-lg text-text-primary">Credential Vault</h2>
            <p className="text-sm text-text-muted">
              Securely store and manage API keys, tokens, and credentials with AES-256 encryption.
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={refresh} disabled={loading}>
          <RefreshIcon className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* ── Body ── */}
      {!isUnlocked ? (
        <UnlockForm onUnlocked={refresh} />
      ) : (
        <>
          <SecretsPanel secrets={secrets} onMutated={refresh} />
          <PassphrasePanel hasPassphrase={hasPassphrase} onChanged={refresh} />
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Unlock Form (locked state)
// ---------------------------------------------------------------------------

function UnlockForm({ onUnlocked }: { onUnlocked: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [, unlock] = useUnlockVault();

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!passphrase.trim()) return;

    const result = await unlock({ passphrase });
    if (result.data?.unlockVault.success) {
      setPassphrase('');
      onUnlocked();
    } else {
      setError(result.data?.unlockVault.error ?? result.error?.message ?? 'Failed to unlock vault');
    }
  };

  return (
    <div className="border-t border-border px-5 py-8">
      <div className="flex flex-col items-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-warning/10 mb-4">
          <LockedIcon className="h-7 w-7 text-warning" />
        </div>
        <h3 className="font-headline text-lg text-text-primary mb-1">Vault is Locked</h3>
        <p className="text-sm text-text-secondary mb-6 text-center max-w-md">
          Your credentials are encrypted with AES-256-GCM. Enter your passphrase to unlock and manage stored secrets.
        </p>
        <form onSubmit={handleUnlock} className="w-full max-w-sm space-y-4">
          <Input
            type="password"
            placeholder="Vault passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            error={error}
            size="lg"
          />
          <Button type="submit" className="w-full" size="lg" disabled={!passphrase.trim()}>
            Unlock Vault
          </Button>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Secrets Panel (inline section, no Card wrapper)
// ---------------------------------------------------------------------------

function SecretsPanel({ secrets, onMutated }: { secrets: VaultSecret[]; onMutated: () => void }) {
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);

  const filtered = secrets.filter((s) => s.key.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <div className="border-t border-border px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">Stored Secrets</h3>
          <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}>
            <PlusIcon /> Add Secret
          </Button>
        </div>

        {secrets.length > 3 && (
          <Input placeholder="Search secrets..." value={search} onChange={(e) => setSearch(e.target.value)} size="sm" />
        )}

        {filtered.length === 0 ? (
          <SecretsEmptyState hasSearch={search.length > 0} onAdd={() => setAddOpen(true)} />
        ) : (
          <div className="space-y-1">
            {filtered.map((secret) => (
              <SecretRow
                key={secret.key}
                secret={secret}
                onEdit={() => setEditKey(secret.key)}
                onDelete={() => setDeleteKey(secret.key)}
              />
            ))}
          </div>
        )}
      </div>

      <AddSecretModal open={addOpen} onClose={() => setAddOpen(false)} onAdded={onMutated} />
      <EditSecretModal secretKey={editKey} onClose={() => setEditKey(null)} onUpdated={onMutated} />
      <DeleteSecretModal secretKey={deleteKey} onClose={() => setDeleteKey(null)} onDeleted={onMutated} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Passphrase Panel (inline section, no Card wrapper)
// ---------------------------------------------------------------------------

function PassphrasePanel({ hasPassphrase, onChanged }: { hasPassphrase: boolean; onChanged: () => void }) {
  const [mode, setMode] = useState<'idle' | 'set' | 'change' | 'remove'>('idle');

  return (
    <div className="border-t border-border px-5 py-4 space-y-3">
      <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">Vault Security</h3>
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-bg-tertiary flex-shrink-0">
          <ShieldIcon />
        </div>
        <div className="flex-1 min-w-0">
          {hasPassphrase ? (
            <>
              <p className="text-sm text-text-primary">Passphrase protection is enabled</p>
              <p className="text-xs text-text-muted mt-0.5">
                Your vault requires a passphrase on server restart. All secrets are encrypted with AES-256-GCM.
              </p>
              {mode === 'idle' && (
                <div className="flex gap-2 mt-3">
                  <Button variant="secondary" size="sm" onClick={() => setMode('change')}>
                    Change Passphrase
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setMode('remove')}>
                    Remove Passphrase
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-text-primary">No passphrase set</p>
                <p className="text-xs text-text-muted mt-0.5">
                  Your vault auto-unlocks on startup. Set a passphrase to require authentication before secrets can be
                  accessed.
                </p>
              </div>
              {mode === 'idle' && (
                <Button variant="secondary" size="sm" onClick={() => setMode('set')} className="flex-shrink-0">
                  Set Passphrase
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {mode === 'set' && (
        <SetPassphraseForm
          onDone={() => {
            setMode('idle');
            onChanged();
          }}
          onCancel={() => setMode('idle')}
        />
      )}
      {mode === 'change' && (
        <ChangePassphraseForm
          onDone={() => {
            setMode('idle');
            onChanged();
          }}
          onCancel={() => setMode('idle')}
        />
      )}
      {mode === 'remove' && (
        <RemovePassphraseForm
          onDone={() => {
            setMode('idle');
            onChanged();
          }}
          onCancel={() => setMode('idle')}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Passphrase Forms
// ---------------------------------------------------------------------------

function SetPassphraseForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [, setPassphrase] = useSetVaultPassphrase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPass !== confirm) {
      setError('Passphrases do not match');
      return;
    }
    if (newPass.length < 4) {
      setError('Passphrase must be at least 4 characters');
      return;
    }

    const result = await setPassphrase({ newPassphrase: newPass });
    if (result.data?.setVaultPassphrase.success) {
      onDone();
    } else {
      setError(result.data?.setVaultPassphrase.error ?? result.error?.message ?? 'Failed to set passphrase');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-border-light pt-4 mt-4">
      <Input
        type="password"
        label="New Passphrase"
        placeholder="Enter passphrase"
        value={newPass}
        onChange={(e) => setNewPass(e.target.value)}
        size="sm"
      />
      <Input
        type="password"
        label="Confirm Passphrase"
        placeholder="Re-enter passphrase"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={error}
        size="sm"
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={!newPass || !confirm}>
          Set Passphrase
        </Button>
      </div>
    </form>
  );
}

function ChangePassphraseForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [, changePassphrase] = useChangeVaultPassphrase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPass !== confirm) {
      setError('New passphrases do not match');
      return;
    }
    if (newPass.length < 4) {
      setError('Passphrase must be at least 4 characters');
      return;
    }

    const result = await changePassphrase({ currentPassphrase: currentPass, newPassphrase: newPass });
    if (result.data?.changeVaultPassphrase.success) {
      onDone();
    } else {
      setError(result.data?.changeVaultPassphrase.error ?? result.error?.message ?? 'Failed to change passphrase');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-border-light pt-4 mt-4">
      <Input
        type="password"
        label="Current Passphrase"
        placeholder="Enter current passphrase"
        value={currentPass}
        onChange={(e) => setCurrentPass(e.target.value)}
        size="sm"
      />
      <Input
        type="password"
        label="New Passphrase"
        placeholder="Enter new passphrase"
        value={newPass}
        onChange={(e) => setNewPass(e.target.value)}
        size="sm"
      />
      <Input
        type="password"
        label="Confirm New Passphrase"
        placeholder="Re-enter new passphrase"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={error}
        size="sm"
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" type="submit" disabled={!currentPass || !newPass || !confirm}>
          Change Passphrase
        </Button>
      </div>
    </form>
  );
}

function RemovePassphraseForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [currentPass, setCurrentPass] = useState('');
  const [error, setError] = useState('');
  const [, changePassphrase] = useChangeVaultPassphrase();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Remove passphrase = change to empty string
    const result = await changePassphrase({ currentPassphrase: currentPass, newPassphrase: '' });
    if (result.data?.changeVaultPassphrase.success) {
      onDone();
    } else {
      setError(result.data?.changeVaultPassphrase.error ?? result.error?.message ?? 'Failed to remove passphrase');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-border-light pt-4 mt-4">
      <p className="text-sm text-warning">
        Removing the passphrase means the vault will auto-unlock on server startup without authentication.
      </p>
      <Input
        type="password"
        label="Current Passphrase"
        placeholder="Confirm current passphrase"
        value={currentPass}
        onChange={(e) => setCurrentPass(e.target.value)}
        error={error}
        size="sm"
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="danger" size="sm" type="submit" disabled={!currentPass}>
          Remove Passphrase
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Secret Row
// ---------------------------------------------------------------------------

function SecretRow({ secret, onEdit, onDelete }: { secret: VaultSecret; onEdit: () => void; onDelete: () => void }) {
  const age = formatRelativeTime(secret.updatedAt);

  return (
    <div className="group flex items-center justify-between rounded-lg px-3 py-2.5 transition-colors hover:bg-bg-hover">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-primary/10 flex-shrink-0">
          <KeyIcon />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary truncate font-mono">{secret.key}</p>
          <p className="text-xs text-text-muted">Updated {age}</p>
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          <EditIcon />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete}>
          <TrashIcon />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function SecretsEmptyState({ hasSearch, onAdd }: { hasSearch: boolean; onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-bg-tertiary mb-3">
        <KeyIcon className="h-6 w-6 text-text-muted" />
      </div>
      {hasSearch ? (
        <p className="text-sm text-text-muted">No secrets match your search</p>
      ) : (
        <>
          <p className="text-sm text-text-secondary mb-1">No secrets stored yet</p>
          <p className="text-xs text-text-muted mb-4">Add API keys, tokens, and credentials</p>
          <Button size="sm" onClick={onAdd}>
            <PlusIcon /> Add Your First Secret
          </Button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function AddSecretModal({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [, addSecret] = useAddVaultSecret();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!key.trim() || !value.trim()) return;

    const result = await addSecret({ input: { key: key.trim(), value } });
    if (result.data?.addVaultSecret.success) {
      setKey('');
      setValue('');
      onClose();
      onAdded();
    } else {
      setError(result.data?.addVaultSecret.error ?? result.error?.message ?? 'Failed to add secret');
    }
  };

  const handleClose = () => {
    setKey('');
    setValue('');
    setError('');
    onClose();
  };

  return (
    <Modal open={open} onClose={handleClose} title="Add Secret">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Key"
          placeholder="e.g. FMP_API_KEY"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="font-mono"
        />
        <Input
          label="Value"
          type="password"
          placeholder="Secret value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error}
        />
        <p className="text-xs text-text-muted">
          Values are encrypted with AES-256-GCM and never exposed in API responses.
        </p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!key.trim() || !value.trim()}>
            Add Secret
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditSecretModal({
  secretKey,
  onClose,
  onUpdated,
}: {
  secretKey: string | null;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [, updateSecret] = useUpdateVaultSecret();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!secretKey || !value.trim()) return;

    const result = await updateSecret({ input: { key: secretKey, value } });
    if (result.data?.updateVaultSecret.success) {
      setValue('');
      onClose();
      onUpdated();
    } else {
      setError(result.data?.updateVaultSecret.error ?? result.error?.message ?? 'Failed to update secret');
    }
  };

  const handleClose = () => {
    setValue('');
    setError('');
    onClose();
  };

  return (
    <Modal open={!!secretKey} onClose={handleClose} title="Update Secret">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-text-secondary">Key</label>
          <p className="text-sm font-mono text-text-primary bg-bg-tertiary rounded-lg px-3 py-2">{secretKey}</p>
        </div>
        <Input
          label="New Value"
          type="password"
          placeholder="Enter new secret value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          error={error}
        />
        <p className="text-xs text-text-muted">The old value will be permanently replaced. This cannot be undone.</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!value.trim()}>
            Update Value
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteSecretModal({
  secretKey,
  onClose,
  onDeleted,
}: {
  secretKey: string | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [error, setError] = useState('');
  const [, deleteSecret] = useDeleteVaultSecret();

  const handleDelete = async () => {
    if (!secretKey) return;
    setError('');

    const result = await deleteSecret({ key: secretKey });
    if (result.data?.deleteVaultSecret.success) {
      onClose();
      onDeleted();
    } else {
      setError(result.data?.deleteVaultSecret.error ?? result.error?.message ?? 'Failed to delete secret');
    }
  };

  return (
    <Modal open={!!secretKey} onClose={onClose} title="Delete Secret">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete <span className="font-mono font-medium text-text-primary">{secretKey}</span>?
        </p>
        <p className="text-sm text-warning">
          This action cannot be undone. Any services using this credential will stop working.
        </p>
        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete Secret
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function LockedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 text-warning', className)}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

function UnlockedIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-5 w-5 text-success', className)}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M13.5 10.5V6.75a4.5 4.5 0 1 1 9 0v3.75M3.75 21.75h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H3.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z"
      />
    </svg>
  );
}

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4 text-accent-primary', className)}
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg className="h-5 w-5 text-text-muted" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
      />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
      />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M2.985 19.644l3.182-3.182"
      />
    </svg>
  );
}
