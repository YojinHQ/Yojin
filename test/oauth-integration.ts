import { spawn } from 'node:child_process';

import Anthropic from '@anthropic-ai/sdk';
import { config } from 'dotenv';

config();

type AuthMode = 'cli' | 'api_key';

function callClaude(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', model], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => reject(new Error(`Failed to spawn claude: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`claude exited ${code}: ${stderr}`));
      else resolve(stdout.trim());
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function main() {
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  const authMode: AuthMode = oauthToken ? 'cli' : 'api_key';

  if (!oauthToken && !apiKey) {
    console.error('No CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY found');
    process.exit(1);
  }

  console.log('Auth mode:', authMode);
  if (oauthToken) console.log('OAuth token prefix:', oauthToken.slice(0, 15) + '...');
  if (apiKey) console.log('API key prefix:', apiKey.slice(0, 10) + '...');

  const model = 'claude-opus-4-6';

  if (authMode === 'cli') {
    console.log('Testing via Claude CLI subprocess...');
    const response = await callClaude('Say hello in exactly 5 words.', model);
    console.log('Response:', response);
    console.log('Integration test (CLI mode): PASSED');
  } else {
    console.log('Testing via direct API...');
    const client = new Anthropic({ apiKey });
    const res = await client.messages.create({
      model,
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Say hello in exactly 5 words.' }],
    });
    const text = res.content.find((b) => b.type === 'text');
    console.log('Response:', text?.text);
    console.log('Model:', res.model);
    console.log('Usage:', JSON.stringify(res.usage));
    console.log('Integration test (API mode): PASSED');
  }
}

main().catch((err) => {
  console.error('Integration test: FAILED');
  console.error(err.message ?? err);
  process.exit(1);
});
