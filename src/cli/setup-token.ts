/**
 * `yojin setup-token` — acquire a CLAUDE_CODE_OAUTH_TOKEN.
 *
 * Methods:
 *   --method oauth   Browser-based PKCE flow (default)
 *   --method cli     Spawn `claude setup-token` subprocess
 *   --method paste   Manually paste a token
 */

import { createInterface } from 'node:readline';

import { createTokenReference, loginClaudeOAuth, runClaudeSetupToken } from '../auth/claude-oauth.js';

type Method = 'oauth' | 'cli' | 'paste';

function parseMethod(args: string[]): Method {
  const idx = args.indexOf('--method');
  if (idx !== -1 && args[idx + 1]) {
    const val = args[idx + 1] as Method;
    if (['oauth', 'cli', 'paste'].includes(val)) return val;
    console.error(`Unknown method "${val}", defaulting to "oauth"`);
  }
  return 'oauth';
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

export async function setupToken(args: string[]): Promise<void> {
  const method = parseMethod(args);

  console.log(`\nYojin — Claude OAuth token setup (method: ${method})\n`);

  let token: string;

  switch (method) {
    case 'oauth': {
      const result = await loginClaudeOAuth({
        onAuth: async ({ url }) => {
          console.log('Open this URL in your browser to authorize:\n');
          console.log(`  ${url}\n`);
        },
        onPrompt: async ({ message }) => {
          return prompt(`${message}: `);
        },
        onProgress: (msg) => console.log(msg),
      });
      token = result.accessToken;
      break;
    }

    case 'cli': {
      console.log('Running `claude setup-token`…\n');
      const result = await runClaudeSetupToken();
      token = result.token;
      if (result.authUrl) {
        console.log(`Auth URL: ${result.authUrl}`);
      }
      break;
    }

    case 'paste': {
      token = (await prompt('Paste your CLAUDE_CODE_OAUTH_TOKEN: ')).trim();
      if (!token) {
        console.error('No token provided.');
        process.exit(1);
      }
      break;
    }
  }

  console.log(`\nToken acquired: ${createTokenReference(token)}`);
  console.log('\nAdd this to your .env file:\n');
  console.log(`  CLAUDE_CODE_OAUTH_TOKEN=${token}\n`);
}
