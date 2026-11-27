// === Knot Spec ===
export interface KnotSpec {
  version: string; // semver, e.g. '0.1.0'
  name: string; // kebab-case identifier
  display_name: string; // human-readable name
  description: string; // what this knot does
  instructions: string; // system prompt / instructions for the bot
  tools?: ('list_files' | 'read_file' | 'create_file' | 'mcp_call' | 'memory')[];
  integrations?: Record<string, string[]>;
  expected_output?: string; // deliverable and format requested from the bot
  model_preferences?: ModelPreferences;
  lanes?: Record<string, string[]>; // lane name -> ordered strand names
  tags?: string[];
  knowledge_refs?: string[]; // relative paths to reference files
  rules?: KnotRule[];
  created_at?: string; // ISO 8601
  updated_at?: string; // ISO 8601
}

export interface ModelPreferences {
  preferred_capability?: ModelCapability[];
  privacy?: 'local_only' | 'local_preferred' | 'cloud_allowed' | 'any';
  max_output_tokens?: number;
  max_cost_per_run?: number; // budget cap in USD
  preferred_provider?: string; // provider type preference
  preferred_model?: string; // specific model preference
}

export interface KnotRule {
  type: 'allow' | 'deny' | 'require';
  scope: 'provider' | 'model' | 'capability' | 'action';
  value: string;
  reason?: string;
}

// === Provider & Strand ===
export type ProviderType =
  'ollama' | 'openai' | 'anthropic' | 'google' | 'openrouter' | 'openai-compatible';

export interface Strand {
  id: string;
  name: string; // user-given name, e.g. 'my-ollama', 'gpt4-prod'
  provider: ProviderType;
  model: string; // model identifier, e.g. 'llama3', 'gpt-4o'
  endpoint?: string; // for Ollama or custom endpoints
  api_key_ref?: string; // reference to keychain entry (never store raw key)
  capabilities: ModelCapability[];
  routing?: StrandRouting;
  is_local: boolean;
  is_default?: boolean;
  created_at: string;
  updated_at?: string;
}

export interface StrandRouting {
  context_window?: number;
  input_usd_per_million?: number;
  output_usd_per_million?: number;
}

export type ModelCapability =
  | 'tool_calling'
  | 'vision'
  | 'structured_output'
  | 'long_context'
  | 'streaming'
  | 'system_prompt'
  | 'json_mode'
  | 'code_execution';

export interface ProviderConfig {
  type: ProviderType;
  endpoint?: string;
  api_key?: string; // only in memory, never persisted
  default_model?: string;
  options?: Record<string, unknown>;
}

// === Model Request/Response ===
export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
}

export interface ModelRequest {
  messages: ModelMessage[];
  model: string;
  system?: string; // system prompt (some providers handle separately)
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
  response_format?: 'text' | 'json';
  stream?: boolean;
  signal?: AbortSignal;
}

export interface ModelResponse {
  content: string;
  model: string;
  usage: TokenUsage;
  finish_reason: 'stop' | 'length' | 'error' | 'unknown';
  latency_ms?: number;
}

export interface ModelChunk {
  delta: string;
  is_final: boolean;
  usage?: TokenUsage; // only on final chunk
  model?: string; // only on final chunk
  finish_reason?: string; // only on final chunk
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ConnectionResult {
  success: boolean;
  error?: string;
  latency_ms?: number;
  models_available?: string[];
}

export interface ModelInfo {
  id: string;
  name?: string;
  provider?: ProviderType | string;
  capabilities?: ModelCapability[];
  context_length?: number;
  description?: string;
}

export interface ModelProvider {
  id?: string;
  name?: string;
  type?: ProviderType;
  sendMessage(request: ModelRequest): AsyncGenerator<ModelChunk>;
  sendMessageSync(request: ModelRequest): Promise<ModelResponse>;
  listModels(): Promise<ModelInfo[]>;
  testConnection(): Promise<ConnectionResult>;
  getCapabilities(model: string): ModelCapability[];
}

export type Provider = ModelProvider;

// === Lane ===
export interface Lane {
  id: string;
  name: string; // e.g. 'default', 'local-only', 'fast'
  strand_order: string[]; // ordered list of strand names
  created_at: string;
  updated_at?: string;
}

// === Run (Pull) ===
export type RunStatus =
  | 'paused'
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface Run {
  id: string;
  knot_name: string;
  strand_id: string;
  strand_name: string;
  status: RunStatus;
  input: string;
  output?: string;
  model_used: string;
  tokens_in?: number;
  tokens_out?: number;
  cost?: number;
  error?: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
}

// === Events ===
export interface RunEvent {
  type: 'started' | 'progress' | 'chunk' | 'completed' | 'failed' | 'cancelled';
  run_id: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

// === Settings ===
export interface AppSettings {
  data_dir: string;
  knots_dir: string;
  default_lane?: string;
  hotkey?: string;
  theme?: 'dark' | 'light';
}

// === Errors ===
export type ProviderErrorCode =
  | 'auth_error'
  | 'rate_limit'
  | 'model_not_found'
  | 'connection_error'
  | 'timeout'
  | 'invalid_request'
  | 'context_length_exceeded'
  | 'server_error'
  | 'unknown';

export interface ProviderError {
  code: ProviderErrorCode;
  message: string;
  provider: ProviderType;
  model?: string;
  retryable: boolean;
  retry_after_ms?: number;
}

// === Compatibility Aliases & Types ===
export type SemVer = string;
export type PrivacyLevel = 'local_only' | 'local_preferred' | 'cloud_allowed' | 'any';
export type MessageRole = 'system' | 'user' | 'assistant';
export type ChatMessage = ModelMessage;

export interface CompletionOptions {
  model: string;
  messages: ModelMessage[];
  temperature?: number;
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
}

export type CompletionResult = ModelResponse;
export type ProviderId = ProviderType | string;

export interface Repository<T> {
  getAll(): Promise<T[]>;
  getById(id: string): Promise<T | undefined>;
  create(item: T): Promise<T>;
  update(id: string, item: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
}

// === Cross-Chat Memory & Inter-Bot Plan Collaboration ===
export type MemoryPrivacy = 'local_only' | 'cloud_allowed';

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  privacy: MemoryPrivacy;
  source_run_id?: string;
  source_conversation_id?: string;
  created_at: string;
  updated_at: string;
}

export interface PlanMessage {
  id: string;
  plan_id: string;
  from_task_id: string;
  to_task_id?: string;
  body: string;
  privacy: MemoryPrivacy;
  created_at: string;
}

// Reviewed text evaluations. Tool workflows require a separate fixture executor.
export interface EvaluationCase {
  id: string;
  input: string;
  split: 'improvement' | 'holdout';
  criteria: string;
  contains: string[];
  exact?: string;
  json?: boolean;
  sourceRunId?: string;
}
export interface EvaluationSuite {
  id: string;
  name: string;
  knotName: string;
  version: number;
  previousId?: string;
  cases: EvaluationCase[];
  policy: KnotSpec[];
  botHash: string;
  createdAt: string;
}
