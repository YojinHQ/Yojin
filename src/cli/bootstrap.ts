/**
 * Bootstrap mode — collect LLM provider credentials when none are configured.
 *
 * Pure TTY interaction, no LLM calls. Presents options for API key entry,
 * OAuth flow, or skip. Stores credentials in vault and reinitializes the provider.
 */

import type { SecretVault } from '../trust/vault/types.js';

export interface BootstrapDeps {
  readSecret: (prompt: string) => Promise<string>;
  vault: SecretVault;
  reinitializeProvider: () => Promise<boolean>;
  prompt: (question: string) => Promise<string>;
  log: (message: string) => void;
}

export interface BootstrapResult {
  success: boolean;
  skipped?: boolean;
}

export async function runBootstrap(deps: BootstrapDeps): Promise<BootstrapResult> {
  const { readSecret, vault, reinitializeProvider, prompt, log } = deps;

  log("\n  Hey! I need an LLM provider to think. Let's set one up:\n");
  log('  1) Paste an Anthropic API key (secure input, hidden)');
  log('  2) Run OAuth flow (opens browser)');
  log('  3) Skip for now (exit)\n');

  while (true) {
    const choice = (await prompt('  Pick [1/2/3]: ')).trim();

    if (choice === '3') {
      return { success: false, skipped: true };
    }

    if (choice === '1') {
      const key = await readSecret('  Anthropic API key (hidden): ');
      if (!key) {
        log('  Empty input — try again.\n');
        continue;
      }

      await vault.set('ANTHROPIC_API_KEY', key);
      // Vault is the durable store. process.env is set temporarily so
      // reinitializeProvider() can pick up the key without a restart.
      // Exposure: visible to child processes and /proc on Linux.
      process.env.ANTHROPIC_API_KEY = key;

      const ok = await reinitializeProvider();
      if (ok) {
        log('  Connected!\n');
        return { success: true };
      }

      log("  That key didn't work. Try again?\n");
      continue;
    }

    if (choice === '2') {
      try {
        const { runOAuthFlow } = await import('./setup-token.js');
        const { token } = await runOAuthFlow();
        await vault.set('CLAUDE_CODE_OAUTH_TOKEN', token);
        // Vault is the durable store. process.env is set temporarily so
        // reinitializeProvider() can pick up the key without a restart.
        // Exposure: visible to child processes and /proc on Linux.
        process.env.CLAUDE_CODE_OAUTH_TOKEN = token;

        const ok = await reinitializeProvider();
        if (ok) {
          log('  Connected!\n');
          return { success: true };
        }
        log("  OAuth token didn't work. Try again?\n");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`  OAuth flow failed: ${msg}\n`);
      }
      continue;
    }

    log('  Invalid choice. Pick 1, 2, or 3.\n');
  }
}
