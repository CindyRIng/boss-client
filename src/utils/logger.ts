/**
 * JSONL 文件日志（按大小轮转）+ stdout
 */
import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEYS = /password|passwd|token|cookie|authorization|secret|qr|base64|captcha|code/i;

export interface LoggerOptions {
  file?: string;
  maxBytes?: number;
  keep?: number;
  level?: LogLevel;
  stdout?: boolean;
}

export class Logger {
  private readonly file?: string;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly level: LogLevel;
  private readonly stdout: boolean;
  private size = 0;

  constructor(opts: LoggerOptions = {}) {
    this.file = opts.file;
    this.maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
    this.keep = Math.max(1, opts.keep ?? 5);
    this.level = opts.level ?? 'info';
    this.stdout = opts.stdout ?? true;
    if (this.file) {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      try {
        this.size = fs.statSync(this.file).size;
      } catch {
        this.size = 0;
      }
    }
  }

  debug(event: string, fields?: Record<string, unknown>): void {
    this.write('debug', event, fields);
  }
  info(event: string, fields?: Record<string, unknown>): void {
    this.write('info', event, fields);
  }
  warn(event: string, fields?: Record<string, unknown>): void {
    this.write('warn', event, fields);
  }
  error(event: string, fields?: Record<string, unknown>): void {
    this.write('error', event, fields);
  }

  private write(level: LogLevel, event: string, fields?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const record = {
      ts: new Date().toISOString(),
      level,
      event,
      ...(fields ? (redactRecord(fields) as Record<string, unknown>) : {}),
    };
    const line = `${JSON.stringify(record)}\n`;
    if (this.file) {
      try {
        fs.appendFileSync(this.file, line, 'utf8');
        this.size += Buffer.byteLength(line);
        if (this.size >= this.maxBytes) this.rotate();
      } catch {
        /* ignore */
      }
    }
    if (this.stdout) process.stdout.write(line);
  }

  private rotate(): void {
    if (!this.file) return;
    try {
      const oldest = `${this.file}.${this.keep}`;
      if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
      for (let i = this.keep - 1; i >= 1; i--) {
        const from = `${this.file}.${i}`;
        const to = `${this.file}.${i + 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      if (fs.existsSync(this.file)) fs.renameSync(this.file, `${this.file}.1`);
      fs.writeFileSync(this.file, '', 'utf8');
      this.size = 0;
    } catch {
      /* ignore */
    }
  }
}

export function redactRecord(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactRecord);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.test(k)) {
        out[k] = '***';
      } else if (/phone|mobile/i.test(k) && typeof v === 'string') {
        out[k] = v.length >= 7 ? `${v.slice(0, 3)}****${v.slice(-4)}` : '***';
      } else {
        out[k] = redactRecord(v);
      }
    }
    return out;
  }
  return value;
}

export function createLogger(opts: LoggerOptions): Logger {
  return new Logger(opts);
}
