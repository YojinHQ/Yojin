/**
 * Cross-platform shutdown signal registration.
 *
 * POSIX: SIGINT (Ctrl+C) + SIGTERM (kill).
 * Windows: SIGINT (Ctrl+C) + SIGBREAK (Ctrl+Break). Node accepts SIGTERM
 * listeners on Windows but never delivers them, so registering it would be
 * dead code on that platform.
 */
export function onShutdownSignal(handler: () => void): void {
  const signals: NodeJS.Signals[] = process.platform === 'win32' ? ['SIGINT', 'SIGBREAK'] : ['SIGINT', 'SIGTERM'];
  for (const sig of signals) {
    process.on(sig, handler);
  }
}
