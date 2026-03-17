import { describe, expect, it } from 'vitest';

import { OutputDlpGuard } from '../../../src/guards/security/output-dlp.js';
import type { ProposedAction } from '../../../src/guards/types.js';

function action(output: string): ProposedAction {
  return { type: 'tool_call', output };
}

describe('OutputDlpGuard', () => {
  const guard = new OutputDlpGuard();

  it('passes when no output in action', () => {
    expect(guard.check({ type: 'tool_call' }).pass).toBe(true);
  });

  it('passes clean output', () => {
    expect(guard.check(action('AAPL price is $150.00')).pass).toBe(true);
    expect(guard.check(action('Portfolio value: $50,000')).pass).toBe(true);
  });

  it('detects AWS access keys', () => {
    const result = guard.check(action('Key: AKIAIOSFODNN7EXAMPLE'));
    expect(result.pass).toBe(false);
    if (!result.pass) {
      expect(result.reason).toContain('AWS');
    }
  });

  it('detects Anthropic API keys', () => {
    const result = guard.check(action('sk-ant-api03-abcdefghijklmnopqrstuvwxyz'));
    expect(result.pass).toBe(false);
  });

  it('detects PEM private keys', () => {
    const result = guard.check(action('-----BEGIN RSA PRIVATE KEY-----'));
    expect(result.pass).toBe(false);
  });

  it('detects JWT tokens', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = guard.check(action(jwt));
    expect(result.pass).toBe(false);
  });

  it('detects GitHub tokens', () => {
    expect(guard.check(action('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij')).pass).toBe(false);
  });

  it('detects Slack tokens', () => {
    expect(guard.check(action('xoxb-1234567890-abcdefghij')).pass).toBe(false);
  });

  it('detects credential key-value patterns', () => {
    expect(guard.check(action('password=mysupersecretpassword123')).pass).toBe(false);
    expect(guard.check(action('api_key: sk_test_abcdef123456')).pass).toBe(false);
  });

  it('detects AWS secret keys in key-value context', () => {
    expect(guard.check(action('aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')).pass).toBe(false);
  });

  it('does not false-positive on generic base64 strings', () => {
    // 40-char base64 that is NOT an AWS secret key (e.g. a SHA hash)
    expect(guard.check(action('hash: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2')).pass).toBe(true);
  });
});
