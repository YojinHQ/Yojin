/**
 * Claude Code OAuth PKCE flow.
 *
 * Supports three token acquisition methods:
 *   - "oauth":  Browser-based PKCE flow
 *   - "cli":    Spawn `claude setup-token` subprocess
 *   - "paste":  Manual token pasting
 */

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const CLAUDE_CODE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const OAUTH_REDIRECT_URI = 'https://platform.claude.com/oauth/code/callback';
const OAUTH_SCOPES = 'org:create_api_key user:profile user:inference';

export interface ClaudeOAuthResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

export function generatePkceParams() {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const state = randomBytes(32).toString('base64url');
  return { codeVerifier, codeChallenge, state };
}

export function buildClaudeOAuthUrl(params: { codeChallenge: string; state: string }): string {
  const searchParams = new URLSearchParams({
    code: 'true',
    client_id: CLAUDE_CODE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: OAUTH_REDIRECT_URI,
    scope: OAUTH_SCOPES,
    code_challenge: params.codeChallenge,
    code_challenge_method: 'S256',
    state: params.state,
  });
  return `https://platform.claude.com/oauth/authorize?${searchParams.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export async function exchangeClaudeOAuthCode(params: {
  code: string;
  codeVerifier: string;
  state?: string;
}): Promise<ClaudeOAuthResult> {
  const body = {
    grant_type: 'authorization_code',
    client_id: CLAUDE_CODE_CLIENT_ID,
    code: params.code,
    redirect_uri: OAUTH_REDIRECT_URI,
    code_verifier: params.codeVerifier,
    ...(params.state ? { state: params.state } : {}),
  };

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Referer: 'https://platform.claude.com/',
    Origin: 'https://platform.claude.com',
  };

  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    // Fallback: try form-urlencoded
    const formParams = new URLSearchParams();
    formParams.set('grant_type', 'authorization_code');
    formParams.set('client_id', CLAUDE_CODE_CLIENT_ID);
    formParams.set('code', params.code);
    formParams.set('redirect_uri', OAUTH_REDIRECT_URI);
    formParams.set('code_verifier', params.codeVerifier);
    if (params.state) {
      formParams.set('state', params.state);
    }

    const formResponse = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formParams.toString(),
    });

    if (!formResponse.ok) {
      const errorText = await formResponse.text().catch(() => 'unknown');
      throw new Error(`OAuth token exchange failed: ${formResponse.status} ${errorText}`);
    }

    return parseTokenResponse(await formResponse.json());
  }

  return parseTokenResponse(await response.json());
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

export async function refreshClaudeOAuthToken(refreshToken: string): Promise<ClaudeOAuthResult> {
  const response = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      client_id: CLAUDE_CODE_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`OAuth token refresh failed: ${response.status} ${errorText}`);
  }

  return parseTokenResponse(await response.json());
}

// ---------------------------------------------------------------------------
// CLI subprocess: `claude setup-token`
// ---------------------------------------------------------------------------

export function runClaudeSetupToken(): Promise<{
  token: string;
  authUrl?: string;
}> {
  return new Promise((resolve, reject) => {
    let output = '';
    let capturedToken = '';
    let capturedUrl = '';

    const child = spawn('claude', ['setup-token'], {
      env: { ...process.env, CI: 'true', TERM: 'xterm-256color' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const processChunk = (chunk: string) => {
      output += chunk;

      const tokenMatch = chunk.match(/sk-ant-[a-zA-Z0-9_-]+/);
      if (tokenMatch) {
        capturedToken = tokenMatch[0];
      }

      const urlMatch =
        chunk.match(/https:\/\/claude\.ai\/oauth\/[^\s\n]+/) ??
        chunk.match(/https:\/\/console\.anthropic\.com[^\s\]<\n]+/);
      if (urlMatch) {
        capturedUrl = urlMatch[0];
      }
    };

    child.stdout?.on('data', (data: Buffer) => processChunk(data.toString()));
    child.stderr?.on('data', (data: Buffer) => processChunk(data.toString()));

    child.on('close', (code) => {
      if (capturedToken) {
        resolve({ token: capturedToken, authUrl: capturedUrl || undefined });
      } else if (code === 0 && output.includes('sk-ant-')) {
        const finalMatch = output.match(/sk-ant-[a-zA-Z0-9_-]+/);
        if (finalMatch) {
          resolve({
            token: finalMatch[0],
            authUrl: capturedUrl || undefined,
          });
        } else {
          reject(new Error('setup-token completed but no token found in output'));
        }
      } else {
        reject(new Error(`claude setup-token exited with code ${code}. Output: ${output.slice(0, 500)}`));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to run claude setup-token: ${err.message}`));
    });

    // Timeout after 5 minutes
    setTimeout(
      () => {
        child.kill();
        if (capturedToken) {
          resolve({ token: capturedToken, authUrl: capturedUrl || undefined });
        } else {
          reject(new Error('claude setup-token timed out after 5 minutes'));
        }
      },
      5 * 60 * 1000,
    );
  });
}

// ---------------------------------------------------------------------------
// High-level login flow
// ---------------------------------------------------------------------------

export async function loginClaudeOAuth(params: {
  onAuth: (event: { url: string }) => Promise<void>;
  onPrompt: (prompt: { message: string; placeholder?: string }) => Promise<string>;
  onProgress?: (message: string) => void;
}): Promise<ClaudeOAuthResult> {
  params.onProgress?.('Generating PKCE challenge…');
  const pkce = generatePkceParams();
  const url = buildClaudeOAuthUrl({
    codeChallenge: pkce.codeChallenge,
    state: pkce.state,
  });

  await params.onAuth({ url });

  params.onProgress?.('Waiting for authorization code…');
  const code = await params.onPrompt({
    message: 'Paste the authorization code from the browser',
    placeholder: 'code from redirect page',
  });

  const trimmedCode = code.trim();
  if (!trimmedCode) {
    throw new Error('No authorization code provided.');
  }

  params.onProgress?.('Exchanging code for token…');
  return exchangeClaudeOAuthCode({
    code: trimmedCode,
    codeVerifier: pkce.codeVerifier,
    state: pkce.state,
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function createTokenReference(token: string): string {
  if (!token || token.length < 8) {
    return '[INVALID_TOKEN]';
  }
  const prefix = token.substring(0, 12);
  const hash = createHash('sha256').update(token).digest('hex').substring(0, 8);
  return `${prefix}...${hash}`;
}

function parseTokenResponse(data: unknown): ClaudeOAuthResult {
  const d = data as Record<string, unknown>;
  if (typeof d.access_token !== 'string' || !d.access_token) {
    throw new Error('Token exchange returned no access_token');
  }
  return {
    accessToken: d.access_token,
    refreshToken: typeof d.refresh_token === 'string' ? d.refresh_token : undefined,
    expiresIn: typeof d.expires_in === 'number' ? d.expires_in : undefined,
  };
}
