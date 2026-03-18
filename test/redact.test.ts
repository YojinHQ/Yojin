import { describe, expect, it } from 'vitest';

import { maskToken, redact } from '../src/logging/redact.js';

describe('redact', () => {
  it('redacts Anthropic API keys', () => {
    const input = 'key is sk-ant-api03-abcdefghijklmnopqrstuvwxyz';
    expect(redact(input)).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(redact(input)).toContain('sk-ant-api**-****');
  });

  it('redacts Anthropic OAuth tokens', () => {
    const input = 'token: sk-ant-oat01-abcdefghijklmnopqrstuvwxyz';
    expect(redact(input)).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(redact(input)).toContain('sk-ant-oat**-****');
  });

  it('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    expect(redact(input)).toContain('Bearer ****');
    expect(redact(input)).not.toContain('eyJhbGciOiJ');
  });

  it('redacts Slack tokens', () => {
    expect(redact('xoxb-1234567890-abcdefghijklmnop')).toContain('xoxb-****');
    expect(redact('xoxp-1234567890-abcdefghijklmnop')).toContain('xoxp-****');
    expect(redact('xapp-1234567890-abcdefghijklmnop')).toContain('xapp-****');
  });

  it('redacts JSON credential fields', () => {
    const input = '{"access_token":"sk-secret-value-12345","name":"test"}';
    const result = redact(input);
    expect(result).not.toContain('sk-secret-value');
    expect(result).toContain('"access_token":"****"');
  });

  it('redacts PEM private keys', () => {
    const input = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...\n-----END PRIVATE KEY-----';
    expect(redact(input)).toContain('REDACTED PRIVATE KEY');
    expect(redact(input)).not.toContain('MIIEvQIBADANBg');
  });

  it('leaves normal text untouched', () => {
    const input = 'This is a normal log message about processing 42 records';
    expect(redact(input)).toBe(input);
  });
});

describe('maskToken', () => {
  it('masks the middle of a token', () => {
    const token = 'sk-ant-oat01-a4b5c6d7e8f9g0h1i2j3k4l5m6';
    const masked = maskToken(token);
    expect(masked).toMatch(/^sk-ant-oat01-a4\.\.\.l5m6$/);
  });

  it('returns **** for short tokens', () => {
    expect(maskToken('short')).toBe('****');
    expect(maskToken('')).toBe('****');
  });
});
