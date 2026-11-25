/**
 * Ambient type definitions for Node.js built-ins and external libraries
 * used by @knots/core.
 */

declare module 'node:buffer' {
  export interface Buffer {
    toString(encoding?: string): string;
  }
  export const Buffer: {
    from(data: string, encoding?: string): Buffer;
    from(data: Uint8Array): Buffer;
    concat(list: readonly Uint8Array[]): Buffer;
  };
}

declare module 'node:fs' {
  export interface Stats {
    mtime: Date;
    size: number;
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
  }
  export function chmodSync(path: string, mode: number): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  export function renameSync(source: string, destination: string): void;
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(
    path: string,
    data: string,
    options?: { encoding?: string; mode?: number; flag?: string } | string,
  ): void;
  export function mkdirSync(
    path: string,
    options?: { recursive?: boolean; mode?: number },
  ): string | undefined;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): Stats;
  export function lstatSync(path: string): Stats;
  export function unlinkSync(path: string): void;
  export function copyFileSync(src: string, dest: string): void;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export function isAbsolute(p: string): boolean;
}

declare module 'node:os' {
  export function homedir(): string;
  export function hostname(): string;
  export function userInfo(): { username: string; homedir: string };
  export function platform(): string;
}

declare module 'node:crypto' {
  import type { Buffer } from 'node:buffer';
  export interface Cipher {
    update(data: string, inputEnc: string, outputEnc: string): string;
    final(outputEnc: string): string;
    getAuthTag(): Buffer;
  }
  export interface Decipher {
    setAuthTag(tag: Buffer): void;
    update(data: string, inputEnc: string, outputEnc: string): string;
    final(outputEnc: string): string;
  }
  export function randomBytes(size: number): Buffer;
  export function scryptSync(password: string, salt: string, keylen: number): Buffer;
  export function createCipheriv(algorithm: string, key: Buffer, iv: Buffer): Cipher;
  export function createDecipheriv(algorithm: string, key: Buffer, iv: Buffer): Decipher;
}

declare module 'node:events' {
  export class EventEmitter {
    addListener(event: string | symbol, listener: (...args: any[]) => void): this;
    on(event: string | symbol, listener: (...args: any[]) => void): this;
    once(event: string | symbol, listener: (...args: any[]) => void): this;
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
    off(event: string | symbol, listener: (...args: any[]) => void): this;
    removeAllListeners(event?: string | symbol): this;
    emit(event: string | symbol, ...args: any[]): boolean;
    listenerCount(type: string | symbol): number;
  }
}

declare module 'better-sqlite3' {
  namespace BetterSqlite3 {
    interface Statement {
      run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
      get(...params: unknown[]): unknown;
      all(...params: unknown[]): unknown[];
    }
    interface Database {
      prepare(sql: string): Statement;
      exec(sql: string): this;
      pragma(pragma: string, options?: { simple?: boolean }): unknown;
      transaction<F extends (...args: any[]) => any>(fn: F): F;
      close(): this;
    }
  }

  interface DatabaseConstructor {
    new (
      filename: string,
      options?: {
        readonly?: boolean;
        fileMustExist?: boolean;
        timeout?: number;
        verbose?: (...args: any[]) => void;
      },
    ): BetterSqlite3.Database;
    (
      filename: string,
      options?: {
        readonly?: boolean;
        fileMustExist?: boolean;
        timeout?: number;
        verbose?: (...args: any[]) => void;
      },
    ): BetterSqlite3.Database;
  }

  const BetterSqlite3: DatabaseConstructor;
  export = BetterSqlite3;
}

declare module 'ajv' {
  export interface ErrorObject {
    keyword: string;
    instancePath: string;
    schemaPath: string;
    params: Record<string, any>;
    message?: string;
  }
  export interface ValidateFunction {
    (data: unknown): boolean;
    errors?: ErrorObject[] | null;
  }
  export interface Options {
    allErrors?: boolean;
    [key: string]: any;
  }
  export default class Ajv {
    constructor(options?: Options);
    compile(schema: object): ValidateFunction;
  }
}

declare module 'js-yaml' {
  export function load(input: string, options?: any): unknown;
  export function dump(obj: unknown, options?: any): string;
}

declare module 'uuid' {
  export function v4(): string;
}

declare module 'node:fs' {
  export function openSync(path: string, flags: string, mode?: number): number;
  export function closeSync(fd: number): void;
  export function fsyncSync(fd: number): void;
  export function realpathSync(path: string): string;
  export function writeFileSync(fd: number, data: string, encoding: string): void;
}
declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: string): string };
  };
}
