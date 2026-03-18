/**
 * Vault CLI — yojin secret set/show/list/delete
 *
 * SECURITY: Secret values never reach stdout or any capturable output.
 * - `set` uses hidden TTY input (no echo) and refuses non-TTY stdin
 * - `get` is intentionally removed — use MCP server for programmatic access
 * - `show` requires TTY and prints a warning before revealing
 * - All prompts go to stderr (not captured by LLM agents)
 */

import * as readline from 'node:readline';

import { EncryptedVault } from './vault.js';
import { FileAuditLog } from '../audit/audit-log.js';

function getPassphrase(): string {
  const passphrase = process.env.YOJIN_VAULT_PASSPHRASE;
  if (!passphrase) {
    throw new Error(
      'YOJIN_VAULT_PASSPHRASE environment variable is required. ' + 'Set it before running secret commands.',
    );
  }
  return passphrase;
}

/**
 * Ensure stdin is a TTY — refuse to accept secret input from pipes,
 * redirects, or automated agents. This prevents an LLM from feeding
 * secrets through stdin and capturing them in its context.
 */
function requireTty(): void {
  if (!process.stdin.isTTY) {
    console.error('Error: secret commands require an interactive terminal (TTY).');
    console.error('This prevents automated agents from capturing secret values.');
    console.error('Use the MCP server for programmatic access to credentials.');
    process.exit(1);
  }
}

/**
 * Read a secret value from the terminal with echo disabled.
 * The value is never printed to stdout or stderr — only the prompt is shown.
 * Works by switching stdin to raw mode and reading characters directly.
 */
async function readSecretFromTty(prompt: string): Promise<string> {
  // Write prompt to stderr (not captured by LLM agents reading stdout)
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
        // Enter pressed — done
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve(input);
      } else if (code === 3) {
        // Ctrl+C
        stdin.setRawMode(wasRaw ?? false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stderr.write('\n');
        reject(new Error('Cancelled'));
      } else if (code === 127 || code === 8) {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else if (code >= 32) {
        // Printable character — no echo
        input += char;
      }
    };

    stdin.on('data', onData);
  });
}

/**
 * Simple stdin readline for non-secret prompts (e.g., confirmations).
 */
async function readLine(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function runSecretCommand(args: string[]): Promise<void> {
  const subcommand = args[0];
  const auditLog = new FileAuditLog();
  const vault = new EncryptedVault({ auditLog });

  await vault.unlock(getPassphrase());

  switch (subcommand) {
    case 'set': {
      const key = args[1];
      if (!key) {
        console.error('Usage: yojin secret set <key>');
        process.exit(1);
      }
      requireTty();
      const value = await readSecretFromTty(`Enter value for ${key}: `);
      if (!value) {
        console.error('Error: empty value. Secret not saved.');
        process.exit(1);
      }
      await vault.set(key, value);
      console.error(`Secret "${key}" saved.`);
      break;
    }

    case 'show': {
      // Intentionally behind a TTY gate + confirmation — never use `get`
      // from a piped/automated context.
      const key = args[1];
      if (!key) {
        console.error('Usage: yojin secret show <key>');
        process.exit(1);
      }
      requireTty();
      console.error('WARNING: This will display the secret value in your terminal.');
      console.error('Make sure no screen recording, LLM agent, or shared terminal is active.');
      const confirm = await readLine('Type "yes" to continue: ');
      if (confirm.trim().toLowerCase() !== 'yes') {
        console.error('Cancelled.');
        process.exit(0);
      }
      const value = await vault.get(key);
      // Write to stderr so it won't be captured by stdout pipes
      process.stderr.write(value + '\n');
      break;
    }

    case 'list': {
      const keys = await vault.list();
      if (keys.length === 0) {
        console.log('No secrets stored.');
      } else {
        for (const key of keys) {
          console.log(key);
        }
      }
      break;
    }

    case 'delete': {
      const key = args[1];
      if (!key) {
        console.error('Usage: yojin secret delete <key>');
        process.exit(1);
      }
      requireTty();
      const confirmDelete = await readLine(`Delete secret "${key}"? Type "yes" to confirm: `);
      if (confirmDelete.trim().toLowerCase() !== 'yes') {
        console.error('Cancelled.');
        process.exit(0);
      }
      await vault.delete(key);
      console.error(`Secret "${key}" deleted.`);
      break;
    }

    default:
      console.error(`Unknown secret command: ${subcommand}`);
      console.error('Commands: set, show, list, delete');
      console.error('');
      console.error('  set <key>     Store a secret (hidden TTY input, no echo)');
      console.error('  show <key>    Reveal a secret (TTY only, requires confirmation)');
      console.error('  list          List stored secret names (never values)');
      console.error('  delete <key>  Delete a secret');
      process.exit(1);
  }
}
