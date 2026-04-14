/**
 * Spawn a CLI command with stdin detached.
 *
 * Some CLI tools (notably Go binaries) detect piped stdin
 * and try to read a JSON body from it. When spawned from Node.js the
 * pipe is open but empty, causing a "Cannot merge flags with body: <nil>"
 * crash. Setting stdin to 'ignore' prevents this.
 */

import { spawn } from 'node:child_process';

export interface RunCliOptions {
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string>;
}

export function runCli(
  command: string,
  args: string[],
  opts: RunCliOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: opts.env,
      // Windows installs many CLIs (claude, codex, npm, pnpm, etc.) as `.cmd`
      // PATH shims that the OS resolver only finds when invoked through
      // cmd.exe. Node ≥16 escapes args for cmd.exe when shell is true.
      shell: process.platform === 'win32',
    });

    let stdout = '';
    let stderr = '';
    const maxBuffer = opts.maxBuffer ?? 1024 * 1024;

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk;
      if (stdout.length > maxBuffer) child.kill();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });

    const timer = opts.timeout
      ? setTimeout(() => {
          child.kill();
          reject(new Error(`Command timed out after ${opts.timeout}ms`));
        }, opts.timeout)
      : null;

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`Command failed: ${command} ${args.join(' ')}`) as Error & {
          stderr: string;
          stdout: string;
        };
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
      }
    });

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}
