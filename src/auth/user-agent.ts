/**
 * Platform-appropriate Chrome user-agent for OAuth flows.
 *
 * Cloudflare Turnstile (and similar bot defenses) cross-check the UA
 * against TLS/JS fingerprints derived from the real host. Sending a
 * Macintosh UA from a Windows host raises an inconsistency flag and can
 * cause the challenge to fail. Match the UA to `process.platform`.
 */

function getPlatformLabel(): string {
  switch (process.platform) {
    case 'win32':
      return 'Windows NT 10.0; Win64; x64';
    case 'linux':
      return 'X11; Linux x86_64';
    default:
      return 'Macintosh; Intel Mac OS X 10_15_7';
  }
}

export function buildChromeUserAgent(chromeVersion: string): string {
  return `Mozilla/5.0 (${getPlatformLabel()}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
}
