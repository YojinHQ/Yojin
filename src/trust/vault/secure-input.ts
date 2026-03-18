/**
 * Secure input tool — allows the LLM agent to request a credential
 * from the user without ever seeing the value.
 *
 * Flow:
 * 1. LLM calls `store_credential` with a key name and description
 * 2. This tool takes over: prompts the user via stderr, reads with no echo
 * 3. Value goes directly into the encrypted vault
 * 4. LLM receives only: "Credential 'KEELSON_API_KEY' stored successfully"
 *
 * The secret value NEVER appears in stdout, tool results, or LLM context.
 */

import { z } from 'zod';

import type { SecretVault } from './types.js';
import type { ToolDefinition, ToolResult } from '../../core/types.js';

const StoreCredentialParams = z.object({
  /** Vault key name (e.g. 'KEELSON_API_KEY', 'OPENBB_FMP_KEY'). */
  key: z.string().min(1).describe('The name to store the credential under'),
  /** Human-readable description shown in the TTY prompt. */
  description: z.string().describe('Description shown to the user (e.g. "Keelson API key for portfolio enrichment")'),
});

const CheckCredentialParams = z.object({
  key: z.string().min(1).describe('The credential name to check'),
});

const ListCredentialsParams = z.object({});

const DeleteCredentialParams = z.object({
  key: z.string().min(1).describe('The credential name to delete'),
});

export interface SecureInputOptions {
  vault: SecretVault;
  /**
   * Function that reads a secret from the user with no echo.
   * Default uses TTY raw mode via stdin. Override for testing.
   */
  readSecret?: (prompt: string) => Promise<string>;
  /**
   * Function that checks if stdin is a TTY.
   * Default checks process.stdin.isTTY. Override for testing.
   */
  isTty?: () => boolean;
}

/**
 * Read a secret value from TTY with echo disabled.
 * Prompts on stderr so the LLM (reading stdout) never sees it.
 */
async function defaultReadSecret(prompt: string): Promise<string> {
  process.stderr.write(prompt);

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let input = '';

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (char: string): void => {
      const code = char.charCodeAt(0);

      if (char === '\r' || char === '\n') {
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve(input);
      } else if (code === 3) {
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        reject(new Error('Cancelled by user'));
      } else if (code === 127 || code === 8) {
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else if (code >= 32) {
        input += char;
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Create the set of agent tools for credential management.
 * These are registered with ToolRegistry and exposed to the LLM.
 *
 * The LLM can:
 * - `store_credential` — triggers secure TTY input, value never in LLM context
 * - `check_credential` — check if a credential exists (name only)
 * - `list_credentials` — list stored credential names (never values)
 * - `delete_credential` — remove a credential
 */
export function createSecretTools(options: SecureInputOptions): ToolDefinition[] {
  const { vault, readSecret = defaultReadSecret, isTty = () => !!process.stdin.isTTY } = options;

  const storeCredential: ToolDefinition = {
    name: 'store_credential',
    description:
      'Securely collect and store a credential from the user. ' +
      'The value is entered directly by the user in the terminal (hidden input) ' +
      'and stored in the encrypted vault. The actual value is NEVER returned to you.',
    parameters: StoreCredentialParams,
    async execute(params: z.infer<typeof StoreCredentialParams>): Promise<ToolResult> {
      if (!isTty()) {
        return {
          content:
            'Cannot collect credentials: no interactive terminal available. ' +
            'Ask the user to run: yojin secret set ' +
            params.key,
          isError: true,
        };
      }

      try {
        // Prompt the user via stderr — the LLM never sees this
        process.stderr.write(`\n🔐 The agent needs a credential: ${params.description}\n`);
        process.stderr.write(`   Storing as: ${params.key}\n`);

        const value = await readSecret(`   Enter value (hidden): `);

        if (!value) {
          return {
            content: `Credential entry cancelled: empty value for "${params.key}".`,
            isError: true,
          };
        }

        await vault.set(params.key, value);

        // Return ONLY confirmation — never the value
        return { content: `Credential "${params.key}" stored successfully.` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Failed to store credential "${params.key}": ${msg}`, isError: true };
      }
    },
  };

  const checkCredential: ToolDefinition = {
    name: 'check_credential',
    description: 'Check if a named credential exists in the vault. Returns true/false, never the value.',
    parameters: CheckCredentialParams,
    async execute(params: z.infer<typeof CheckCredentialParams>): Promise<ToolResult> {
      const exists = await vault.has(params.key);
      return {
        content: exists ? `Credential "${params.key}" exists.` : `Credential "${params.key}" not found.`,
      };
    },
  };

  const listCredentials: ToolDefinition = {
    name: 'list_credentials',
    description: 'List all stored credential names. Never returns values.',
    parameters: ListCredentialsParams,
    async execute(): Promise<ToolResult> {
      const keys = await vault.list();
      if (keys.length === 0) {
        return { content: 'No credentials stored.' };
      }
      return { content: `Stored credentials:\n${keys.map((k) => `  - ${k}`).join('\n')}` };
    },
  };

  const deleteCredential: ToolDefinition = {
    name: 'delete_credential',
    description: 'Delete a credential from the vault.',
    parameters: DeleteCredentialParams,
    async execute(params: z.infer<typeof DeleteCredentialParams>): Promise<ToolResult> {
      const exists = await vault.has(params.key);
      if (!exists) {
        return { content: `Credential "${params.key}" not found.`, isError: true };
      }
      await vault.delete(params.key);
      return { content: `Credential "${params.key}" deleted.` };
    },
  };

  return [storeCredential, checkCredential, listCredentials, deleteCredential];
}
