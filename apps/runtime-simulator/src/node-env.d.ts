declare module "node:fs" {
  export function readFileSync(path: string, encoding?: string): string;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function readdirSync(path: string): string[];
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string, ext?: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "node:crypto" {
  export interface Hash {
    update(data: string, inputEncoding?: string): this;
    digest(encoding: string): string;
  }
  export function createHash(algorithm: string): Hash;
}

declare namespace NodeJS {
  interface Process {
    argv: string[];
    exit(code?: number): never;
  }
}

declare const process: NodeJS.Process;
