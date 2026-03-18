/**
 * Credential redaction for log output.
 *
 * Automatically masks API keys, OAuth tokens, bearer tokens, PEM keys,
 * and other sensitive patterns before they reach log files.
 */

const REDACTION_PATTERNS: Array<{
  pattern: RegExp;
  replacement: string | ((match: string) => string);
}> = [
  // Anthropic API keys
  { pattern: /sk-ant-api\d{2}-[\w-]{20,}/g, replacement: 'sk-ant-api**-****' },
  // Anthropic OAuth tokens
  { pattern: /sk-ant-oat\d{2}-[\w-]{20,}/g, replacement: 'sk-ant-oat**-****' },
  // Generic API key patterns
  {
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[\w-]{16,}["']?/gi,
    replacement: 'api_key=****',
  },
  // Bearer tokens in headers
  { pattern: /Bearer\s+[\w.-]{16,}/gi, replacement: 'Bearer ****' },
  // Slack tokens
  { pattern: /xoxb-[\w-]{20,}/g, replacement: 'xoxb-****' },
  { pattern: /xoxp-[\w-]{20,}/g, replacement: 'xoxp-****' },
  { pattern: /xapp-[\w-]{20,}/g, replacement: 'xapp-****' },
  // Generic secret/token env var assignments (require KEY_NAME= format)
  {
    pattern: /\b[A-Z_]*(?:SECRET|PASSWORD|CREDENTIAL)[A-Z_]*\s*[:=]\s*["']?[\w/+=-]{8,}["']?/g,
    replacement: '****',
  },
  // PEM private keys
  {
    pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
    replacement: '-----REDACTED PRIVATE KEY-----',
  },
  // JSON credential fields
  {
    pattern: /"(?:password|secret|token|apiKey|api_key|access_token|refresh_token)"\s*:\s*"[^"]+"/gi,
    replacement: (match) => {
      const key = match.split('"')[1];
      return `"${key}":"****"`;
    },
  },
];

/**
 * Redact sensitive values from a string.
 */
export function redact(input: string): string {
  let result = input;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement as string);
  }
  return result;
}

/**
 * Create a masked token reference for safe logging.
 * Preserves prefix for identifiability: "sk-ant-oat01-abc...wxyz"
 */
export function maskToken(token: string, prefixLen = 15, suffixLen = 4): string {
  if (!token || token.length < prefixLen + suffixLen + 4) {
    return '****';
  }
  return `${token.slice(0, prefixLen)}...${token.slice(-suffixLen)}`;
}
