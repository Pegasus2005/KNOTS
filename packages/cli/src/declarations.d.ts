// Ambient type definitions for CLI dependencies

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
    name(str?: string): this | string;
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
