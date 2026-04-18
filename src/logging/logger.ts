import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FlashQueryConfig } from '../config/loader.js';
import { getCurrentCorrelationId } from './context.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types and constants
// ─────────────────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO ',
  warn: 'WARN ',
  error: 'ERROR',
};

// ─────────────────────────────────────────────────────────────────────────────
// Logger class
// ─────────────────────────────────────────────────────────────────────────────

export class Logger {
  private minLevel: number;
  private output: 'stdout' | 'file';
  private filePath?: string;
  private _write: (line: string) => void;

  constructor(logging: FlashQueryConfig['logging'], writeOverride?: (line: string) => void) {
    this.minLevel = LEVEL_RANK[logging.level];
    this.output = logging.output;
    this.filePath = logging.file;
    this._write = writeOverride ?? ((line: string) => this._defaultWrite(line));
  }

  private _defaultWrite(line: string): void {
    if (this.output === 'file' && this.filePath) {
      // Ensure log directory exists before writing (required for Docker volume mounts)
      const logDir = dirname(this.filePath);
      mkdirSync(logDir, { recursive: true });
      appendFileSync(this.filePath, line + '\n', 'utf-8');
    } else {
      process.stderr.write(line + '\n');
    }
  }

  private _timestamp(): string {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  }

  private _emit(level: LogLevel, msg: string): void {
    if (LEVEL_RANK[level] < this.minLevel) return;
    const cid = getCurrentCorrelationId() ?? '----';
    this._write(`[${this._timestamp()} REQ:${cid}] ${LEVEL_LABEL[level]}  ${msg}`);
  }

  debug(msg: string): void {
    this._emit('debug', msg);
  }

  info(msg: string): void {
    this._emit('info', msg);
  }

  warn(msg: string): void {
    this._emit('warn', msg);
  }

  error(msg: string): void {
    this._emit('error', msg);
  }

  detail(msg: string): void {
    this._emit('debug', `  ${msg}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level singleton
// ─────────────────────────────────────────────────────────────────────────────

export let logger: Logger;

export function initLogger(config: FlashQueryConfig | FlashQueryConfig['logging'], writeOverride?: (line: string) => void): void {
  const loggingConfig = 'logging' in config ? config.logging : config;
  logger = new Logger(loggingConfig, writeOverride);
}
