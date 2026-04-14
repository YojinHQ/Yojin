/**
 * Structured logger for Yojin — built on tslog.
 *
 * Features:
 *   - Structured JSON output to rolling log files
 *   - Subsystem-based hierarchical loggers
 *   - Automatic credential redaction
 *   - Console output: pretty (TTY), compact (non-TTY), or JSON
 *   - Configurable via YOJIN_LOG_LEVEL env var
 */

import { appendFileSync, existsSync, mkdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ILogObj, Logger as TsLogger } from 'tslog';

import { resolveDataRoot } from '../paths.js';
import { redact } from './redact.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

const LEVEL_MAP: Record<LogLevel, number> = {
  trace: 1,
  debug: 2,
  info: 3,
  warn: 4,
  error: 5,
  fatal: 6,
  silent: 7,
};

export interface LoggerOptions {
  logDir?: string;
  minLevel?: LogLevel;
  /** Max log file size in bytes before rotating (default: 500MB) */
  maxFileSize?: number;
  /** Console output style: "pretty" (default for TTY), "compact", "json", "hidden" */
  consoleStyle?: 'pretty' | 'compact' | 'json' | 'hidden';
}

// ---------------------------------------------------------------------------
// SubsystemLogger — the public API consumers use
// ---------------------------------------------------------------------------

export interface SubsystemLogger {
  trace(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  fatal(msg: string, meta?: Record<string, unknown>): void;
  child(name: string): SubsystemLogger;
}

// ---------------------------------------------------------------------------
// Logger core
// ---------------------------------------------------------------------------

class YojinLogger {
  private tslog: TsLogger<ILogObj>;
  private logFile: string;
  private logDir: string;
  private maxFileSize: number;
  private fileBytes = 0;

  constructor(opts: LoggerOptions = {}) {
    const envLevel = process.env.YOJIN_LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
    const minLevel = envLevel && LEVEL_MAP[envLevel] ? envLevel : (opts.minLevel ?? 'debug');
    const consoleStyle = opts.consoleStyle ?? (process.stderr.isTTY ? 'pretty' : 'compact');

    this.logDir = opts.logDir ?? join(resolveDataRoot(), 'logs');
    this.maxFileSize = opts.maxFileSize ?? 500 * 1024 * 1024; // 500MB

    mkdirSync(this.logDir, { recursive: true });

    // Create timestamped log file
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    this.logFile = join(this.logDir, `yojin-${ts}.log`);
    writeFileSync(this.logFile, '');

    // Symlink latest.log — skip on Windows where symlinks require admin or
    // Developer Mode; the try/catch below covers POSIX edge cases (e.g. SIP).
    if (process.platform !== 'win32') {
      const latestLink = join(this.logDir, 'latest.log');
      try {
        if (existsSync(latestLink)) unlinkSync(latestLink);
        symlinkSync(this.logFile, latestLink);
      } catch {
        // Not critical
      }
    }

    // Configure tslog
    this.tslog = new TsLogger<ILogObj>({
      name: 'yojin',
      minLevel: LEVEL_MAP[minLevel],
      type: consoleStyle === 'json' ? 'json' : consoleStyle === 'hidden' ? 'hidden' : 'pretty',
      prettyLogTemplate:
        consoleStyle === 'compact' ? '{{logLevelName}} {{name}} ' : '{{hh}}:{{MM}}:{{ss}} {{logLevelName}} {{name}} ',
      stylePrettyLogs: consoleStyle === 'pretty' && process.stderr.isTTY,
      prettyLogTimeZone: 'local',
    });

    // Attach file transport
    this.tslog.attachTransport((logObj) => {
      this.writeToFile(logObj);
    });
  }

  private writeToFile(logObj: ILogObj): void {
    if (this.fileBytes >= this.maxFileSize) return;

    const entry = {
      time: new Date().toISOString(),
      level: (logObj as Record<string, unknown>)['_meta']
        ? ((logObj as Record<string, unknown>)['_meta'] as Record<string, unknown>)['logLevelName']
        : 'INFO',
      name: (logObj as Record<string, unknown>)['_meta']
        ? ((logObj as Record<string, unknown>)['_meta'] as Record<string, unknown>)['name']
        : 'yojin',
      ...logObj,
    };

    // Remove _meta from file output (already extracted above)
    delete (entry as Record<string, unknown>)['_meta'];

    const line = redact(JSON.stringify(entry)) + '\n';
    this.fileBytes += Buffer.byteLength(line);
    appendFileSync(this.logFile, line);
  }

  /**
   * Create a subsystem logger — the primary API for components.
   * Usage: `const log = logger.sub("gateway");`
   */
  sub(subsystem: string): SubsystemLogger {
    return this.createSubLogger(subsystem);
  }

  private createSubLogger(subsystem: string): SubsystemLogger {
    const child = this.tslog.getSubLogger({ name: subsystem });

    const wrap = (level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal') => {
      return (msg: string, meta?: Record<string, unknown>) => {
        if (meta) {
          child[level](msg, meta);
        } else {
          child[level](msg);
        }
      };
    };

    return {
      trace: wrap('trace'),
      debug: wrap('debug'),
      info: wrap('info'),
      warn: wrap('warn'),
      error: wrap('error'),
      fatal: wrap('fatal'),
      child: (name: string) => this.createSubLogger(`${subsystem}/${name}`),
    };
  }

  // Top-level convenience methods
  trace(msg: string, meta?: Record<string, unknown>) {
    this.tslog.trace(msg, meta);
  }
  debug(msg: string, meta?: Record<string, unknown>) {
    this.tslog.debug(msg, meta);
  }
  info(msg: string, meta?: Record<string, unknown>) {
    this.tslog.info(msg, meta);
  }
  warn(msg: string, meta?: Record<string, unknown>) {
    this.tslog.warn(msg, meta);
  }
  error(msg: string, meta?: Record<string, unknown>) {
    this.tslog.error(msg, meta);
  }
  fatal(msg: string, meta?: Record<string, unknown>) {
    this.tslog.fatal(msg, meta);
  }

  getLogFile(): string {
    return this.logFile;
  }
  getLogDir(): string {
    return this.logDir;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: YojinLogger | null = null;

export function initLogger(opts?: LoggerOptions): YojinLogger {
  _instance = new YojinLogger(opts);
  return _instance;
}

export function getLogger(): YojinLogger {
  if (!_instance) {
    _instance = new YojinLogger();
  }
  return _instance;
}

/**
 * Create a subsystem logger directly.
 */
export function createSubsystemLogger(subsystem: string): SubsystemLogger {
  return getLogger().sub(subsystem);
}

/**
 * Create a subsystem logger with a no-op fallback if initialization fails.
 *
 * Use this in modules that may be imported before the logger is initialized
 * (e.g. brain modules loaded at module-evaluation time). If `createSubsystemLogger`
 * throws (because resolveDataRoot / mkdirSync fails), returns a silent no-op logger.
 */
export function createSafeLogger(subsystem: string): SubsystemLogger {
  try {
    return createSubsystemLogger(subsystem);
  } catch {
    const noop = () => {};
    const noopLogger: SubsystemLogger = {
      trace: noop,
      debug: noop,
      info: noop,
      warn: noop,
      error: noop,
      fatal: noop,
      child: () => noopLogger,
    };
    return noopLogger;
  }
}

export { YojinLogger as Logger };
