// Type surface for pi provider plugins, plus the declaration for the one
// runtime helper they use. Type-only imports are erased before execution.

export interface ProviderConfig {
  name?: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  authHeader?: boolean;
  models?: ProviderModelConfig[];
  streamSimple?: (model: unknown, context: unknown, options?: unknown) => unknown;
  fetchDynamicModels?: (apiKey: string | undefined) => Promise<readonly ProviderModelConfig[]>;
  oauth?: unknown;
  [key: string]: unknown;
}

export interface ProviderModelConfig {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinking?: unknown;
  input?: Array<"text" | "image">;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  compat?: unknown;
  [key: string]: unknown;
}

export interface ExtensionCommandContext {
  ui?: { notify?: (message: string, level?: string) => void };
  [key: string]: unknown;
}

export interface ExtensionAPI {
  registerProvider(id: string, config: ProviderConfig): void;
  unregisterProvider?(id: string): void;
  registerCommand(name: string, command: unknown): void;
  on(event: string, handler: (...args: unknown[]) => unknown): undefined | (() => void);
  events?: {
    on(event: string, handler: (...args: unknown[]) => unknown): () => void;
    emit(event: string, ...args: unknown[]): void;
  };
  [key: string]: unknown;
}

export declare function getAgentDir(): string;
