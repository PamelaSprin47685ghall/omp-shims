// Type surface for pi provider plugins, plus the declaration for the one runtime
// helper they use. Type-only imports are erased before execution.

export interface ProviderConfig {
  name: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: unknown[];
  streamSimple?: (model: unknown, context: unknown, options?: unknown) => unknown;
  [key: string]: unknown;
}

export interface ExtensionCommandContext {
  ui?: { notify?: (message: string, level?: string) => void };
  [key: string]: unknown;
}

export interface ExtensionAPI {
  registerProvider(id: string, config: ProviderConfig): void;
  registerCommand(name: string, command: unknown): void;
  on(event: string, handler: (...args: unknown[]) => unknown): void;
  [key: string]: unknown;
}

export declare function getAgentDir(): string;
