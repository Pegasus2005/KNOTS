// Ambient type definitions for Node.js built-ins and CLI dependencies

declare namespace NodeJS {
  export interface ReadableStream {
    isTTY?: boolean;
    setEncoding(encoding: string): this;
    read(): string | null;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
  }

  export interface WritableStream {
    write(chunk: string): boolean;
  }

  export interface Process {
    argv: string[];
    env: Record<string, string | undefined>;
    stdin: ReadableStream;
    stdout: WritableStream;
    stderr: WritableStream;
    exitCode?: number;
    exit(code?: number): never;
    on(event: string, listener: (...args: any[]) => void): this;
  }
}

declare const process: NodeJS.Process;

declare module 'node:os' {
  export function homedir(): string;
  export function hostname(): string;
  export function platform(): string;
  export function userInfo(): { username: string; homedir: string };
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
  export function join(...paths: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
  export function isAbsolute(p: string): boolean;
}

declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(
    path: string,
    data: string,
    options?: { encoding?: string; mode?: number } | string,
  ): void;
}

declare module 'node:readline' {
  export interface Interface {
    prompt(preserveCursor?: boolean): void;
    pause(): this;
    resume(): this;
    close(): void;
    on(event: 'line', listener: (input: string) => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'SIGINT', listener: () => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: 'close', listener: () => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
  }

  export interface ReadLineOptions {
    input: NodeJS.ReadableStream;
    output?: NodeJS.WritableStream;
    prompt?: string;
    terminal?: boolean;
  }

  export function createInterface(options: ReadLineOptions): Interface;
}

declare module 'chalk' {
  export interface ChalkInstance {
    (text: unknown): string;
    bold: ChalkInstance;
    dim: ChalkInstance;
    italic: ChalkInstance;
    underline: ChalkInstance;
    inverse: ChalkInstance;
    hidden: ChalkInstance;
    strikethrough: ChalkInstance;

    black: ChalkInstance;
    red: ChalkInstance;
    green: ChalkInstance;
    yellow: ChalkInstance;
    blue: ChalkInstance;
    magenta: ChalkInstance;
    cyan: ChalkInstance;
    white: ChalkInstance;
    gray: ChalkInstance;
    grey: ChalkInstance;

    bgBlack: ChalkInstance;
    bgRed: ChalkInstance;
    bgGreen: ChalkInstance;
    bgYellow: ChalkInstance;
    bgBlue: ChalkInstance;
    bgMagenta: ChalkInstance;
    bgCyan: ChalkInstance;
    bgWhite: ChalkInstance;
  }

  const chalk: ChalkInstance;
  export default chalk;
}

declare module 'ora' {
  export interface Ora {
    start(text?: string): Ora;
    stop(): Ora;
    succeed(text?: string): Ora;
    fail(text?: string): Ora;
    warn(text?: string): Ora;
    info(text?: string): Ora;
    stopAndPersist(options?: { symbol?: string; text?: string; prefixText?: string }): Ora;
    clear(): Ora;
    render(): Ora;
    text: string;
    color: string;
    isSpinning: boolean;
  }

  export interface Options {
    text?: string;
    spinner?: string | Record<string, unknown>;
    color?: string;
    hideCursor?: boolean;
    indent?: number;
    interval?: number;
    stream?: NodeJS.WritableStream;
    isEnabled?: boolean;
    isSilent?: boolean;
    discardStdin?: boolean;
  }

  export default function ora(options?: string | Options): Ora;
}

declare module 'inquirer' {
  export interface Question {
    type?: 'input' | 'number' | 'password' | 'list' | 'rawlist' | 'expand' | 'checkbox' | 'confirm' | 'editor';
    name: string;
    message: string | ((answers: any) => string);
    default?: any;
    choices?: any[] | ((answers: any) => any[]);
    validate?: (input: any, answers?: any) => boolean | string | Promise<boolean | string>;
    filter?: (input: any, answers?: any) => any;
    when?: boolean | ((answers: any) => boolean | Promise<boolean>);
    pageSize?: number;
    mask?: string;
  }

  export interface PromptModule {
    <T = any>(questions: Question[] | Question): Promise<T>;
  }

  const inquirer: {
    prompt: PromptModule;
    createPromptModule(): PromptModule;
  };

  export default inquirer;
}

declare module 'commander' {
  export interface Option {
    flags: string;
    description: string;
    required: boolean;
    optional: boolean;
    mandatory: boolean;
  }

  export class Command {
    constructor(name?: string);
    name(): string;
    name(str: string): this;
    version(str: string, flags?: string, description?: string): this;
    description(str: string): this;
    command(nameAndArgs: string, opts?: { isDefault?: boolean; hidden?: boolean }): Command;
    addCommand(cmd: Command, opts?: { isDefault?: boolean; hidden?: boolean }): this;
    action(fn: (...args: any[]) => void | Promise<void>): this;
    argument(name: string, description?: string, defaultValue?: any): this;
    option(flags: string, description?: string, defaultValue?: any): this;
    requiredOption(flags: string, description?: string, defaultValue?: any): this;
    opts<T = Record<string, any>>(): T;
    parse(argv?: readonly string[]): this;
    parseAsync(argv?: readonly string[]): Promise<this>;
    help(): void;
    outputHelp(): void;
  }

  export const program: Command;
}
