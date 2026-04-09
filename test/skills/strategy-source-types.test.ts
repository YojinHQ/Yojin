import { describe, expect, it } from 'vitest';

import { DEFAULT_SOURCE_ID, DEFAULT_STRATEGY_SOURCE, parseGitHubUrl } from '../../src/skills/strategy-source-types.js';

describe('parseGitHubUrl', () => {
  it('parses a simple repo URL', () => {
    const result = parseGitHubUrl('https://github.com/acme/strategies');
    expect(result).toEqual({
      owner: 'acme',
      repo: 'strategies',
      path: '',
      ref: 'main',
    });
  });

  it('handles trailing slash', () => {
    const result = parseGitHubUrl('https://github.com/acme/strategies/');
    expect(result).toEqual({
      owner: 'acme',
      repo: 'strategies',
      path: '',
      ref: 'main',
    });
  });

  it('parses tree URL with branch and path', () => {
    const result = parseGitHubUrl('https://github.com/acme/strategies/tree/develop/src/trading');
    expect(result).toEqual({
      owner: 'acme',
      repo: 'strategies',
      path: 'src/trading',
      ref: 'develop',
    });
  });

  it('parses tree URL with nested path', () => {
    const result = parseGitHubUrl('https://github.com/org/repo/tree/v2/deep/nested/path');
    expect(result).toEqual({
      owner: 'org',
      repo: 'repo',
      path: 'deep/nested/path',
      ref: 'v2',
    });
  });

  it('throws on non-GitHub URL', () => {
    expect(() => parseGitHubUrl('https://gitlab.com/acme/repo')).toThrow('Not a GitHub URL');
  });

  it('throws on missing owner/repo', () => {
    expect(() => parseGitHubUrl('https://github.com/')).toThrow('Missing owner/repo');
  });

  it('throws on empty string', () => {
    expect(() => parseGitHubUrl('')).toThrow('URL must not be empty');
  });

  it('throws on blob URL', () => {
    expect(() => parseGitHubUrl('https://github.com/owner/repo/blob/main/file.md')).toThrow('Invalid GitHub URL');
  });
});

describe('DEFAULT_STRATEGY_SOURCE', () => {
  it('has the expected fields', () => {
    expect(DEFAULT_STRATEGY_SOURCE).toEqual({
      id: 'YojinHQ/trading-strategies',
      owner: 'YojinHQ',
      repo: 'trading-strategies',
      path: 'strategies',
      ref: 'main',
      enabled: true,
      label: 'Yojin Official',
    });
  });

  it('DEFAULT_SOURCE_ID matches the source id', () => {
    expect(DEFAULT_SOURCE_ID).toBe(DEFAULT_STRATEGY_SOURCE.id);
  });
});
