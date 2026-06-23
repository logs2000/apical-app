// Apical model registry — the catalog of every model the LLM gateway can
// route to. Three tiers:
//   1. Hosted (Apical-managed) — covered by the plan's token allowance or
//      overrun billing. We pay the provider wholesale; the user pays us retail.
//   2. BYOK (user's own key) — the user pays the provider directly. Free to
//      route through Apical; we just meter for the dashboard (cost = 0).
//   3. Local (self-hosted Ollama / llama.cpp / vLLM) — runs on the user's
//      machine (or the desktop bridge). No per-token cost.
//
// The Models settings page reads this registry + the user's CustomModel rows
// to render the picker. The LLM gateway resolves a modelId → adapter.

export type ProviderId =
  | 'apical'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'azure_openai'
  | 'openrouter'
  | 'mistral'
  | 'groq'
  | 'together'
  | 'deepseek'
  | 'ollama'
  | 'llamacpp'
  | 'vllm'

export type ModelTier = 'hosted' | 'byok' | 'local'

export interface ModelDefinition {
  id: string // canonical id, e.g. "apical:default", "openai:gpt-4o"
  name: string // display name
  provider: ProviderId
  tier: ModelTier
  // The model id passed to the provider's API.
  apiModelId: string // e.g. "gpt-4o", "claude-3-5-sonnet-20241022"
  // Context window in tokens.
  contextWindow: number
  // Retail cost (cents per 1M tokens) for hosted models. 0 for BYOK/local.
  inputCostCentsPer1M: number
  outputCostCentsPer1M: number
  // Capabilities.
  supportsStreaming: boolean
  supportsTools: boolean
  supportsVision: boolean
  // A short description for the picker.
  description: string
  // Whether this is a "fast/cheap" or "thinking/powerful" model.
  badge?: 'fast' | 'powerful' | 'vision' | 'local' | 'byok'
}

// The built-in registry. User-added models (CustomModel rows) are merged on top.
export const MODEL_REGISTRY: ModelDefinition[] = [
  // ---- Hosted (Apical-managed) ----
  {
    id: 'apical:default',
    name: 'Apical Default',
    provider: 'apical',
    tier: 'hosted',
    apiModelId: 'apical-default',
    contextWindow: 128_000,
    inputCostCentsPer1M: 300,
    outputCostCentsPer1M: 900,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Balanced model for everyday agent work. Routes to the best hosted model for the job.',
    badge: 'fast',
  },
  {
    id: 'apical:fast',
    name: 'Apical Fast',
    provider: 'apical',
    tier: 'hosted',
    apiModelId: 'apical-fast',
    contextWindow: 128_000,
    inputCostCentsPer1M: 150,
    outputCostCentsPer1M: 450,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    description: 'Lowest cost for high-volume tool steps. Optimized for speed.',
    badge: 'fast',
  },
  {
    id: 'apical:thinking',
    name: 'Apical Thinking',
    provider: 'apical',
    tier: 'hosted',
    apiModelId: 'apical-thinking',
    contextWindow: 200_000,
    inputCostCentsPer1M: 600,
    outputCostCentsPer1M: 1800,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Deep-reasoning model for planning, research, and complex `reason` steps.',
    badge: 'powerful',
  },

  // ---- OpenAI (BYOK) ----
  {
    id: 'openai:gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    tier: 'byok',
    apiModelId: 'gpt-4o',
    contextWindow: 128_000,
    inputCostCentsPer1M: 250,
    outputCostCentsPer1M: 1000,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'OpenAI flagship multimodal model. Requires your OpenAI API key.',
    badge: 'byok',
  },
  {
    id: 'openai:gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'openai',
    tier: 'byok',
    apiModelId: 'gpt-4o-mini',
    contextWindow: 128_000,
    inputCostCentsPer1M: 15,
    outputCostCentsPer1M: 60,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Fast + cheap. Great default for high-volume tool steps.',
    badge: 'byok',
  },
  {
    id: 'openai:o1',
    name: 'o1',
    provider: 'openai',
    tier: 'byok',
    apiModelId: 'o1',
    contextWindow: 200_000,
    inputCostCentsPer1M: 1500,
    outputCostCentsPer1M: 6000,
    supportsStreaming: false,
    supportsTools: false,
    supportsVision: true,
    description: 'OpenAI reasoning model. Best for hard planning + research.',
    badge: 'powerful',
  },

  // ---- Anthropic (BYOK) ----
  {
    id: 'anthropic:claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'anthropic',
    tier: 'byok',
    apiModelId: 'claude-3-5-sonnet-20241022',
    contextWindow: 200_000,
    inputCostCentsPer1M: 300,
    outputCostCentsPer1M: 1500,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Anthropic flagship. Excellent at long-context reasoning + tool use.',
    badge: 'byok',
  },
  {
    id: 'anthropic:claude-3-5-haiku',
    name: 'Claude 3.5 Haiku',
    provider: 'anthropic',
    tier: 'byok',
    apiModelId: 'claude-3-5-haiku-20241022',
    contextWindow: 200_000,
    inputCostCentsPer1M: 80,
    outputCostCentsPer1M: 400,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Fast + affordable Anthropic model. Good default for agent loops.',
    badge: 'byok',
  },

  // ---- Google (BYOK) ----
  {
    id: 'google:gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    tier: 'byok',
    apiModelId: 'gemini-2.0-flash',
    contextWindow: 1_000_000,
    inputCostCentsPer1M: 100,
    outputCostCentsPer1M: 400,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Google 1M-context model. Great for ingesting huge documents.',
    badge: 'byok',
  },
  {
    id: 'google:gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    tier: 'byok',
    apiModelId: 'gemini-1.5-pro',
    contextWindow: 2_000_000,
    inputCostCentsPer1M: 1250,
    outputCostCentsPer1M: 5000,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Google deep-reasoning model with the largest context window available.',
    badge: 'powerful',
  },

  // ---- Local (self-hosted) ----
  {
    id: 'local:ollama:llama3.1',
    name: 'Llama 3.1 (Ollama)',
    provider: 'ollama',
    tier: 'local',
    apiModelId: 'llama3.1',
    contextWindow: 128_000,
    inputCostCentsPer1M: 0,
    outputCostCentsPer1M: 0,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    description: 'Runs locally via Ollama. Free, private, offline-capable.',
    badge: 'local',
  },
  {
    id: 'local:ollama:qwen2.5',
    name: 'Qwen 2.5 (Ollama)',
    provider: 'ollama',
    tier: 'local',
    apiModelId: 'qwen2.5',
    contextWindow: 32_000,
    inputCostCentsPer1M: 0,
    outputCostCentsPer1M: 0,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    description: 'Strong open model for tool use. Runs locally via Ollama.',
    badge: 'local',
  },
  {
    id: 'local:llamacpp',
    name: 'llama.cpp (custom)',
    provider: 'llamacpp',
    tier: 'local',
    apiModelId: 'custom',
    contextWindow: 32_000,
    inputCostCentsPer1M: 0,
    outputCostCentsPer1M: 0,
    supportsStreaming: true,
    supportsTools: false,
    supportsVision: false,
    description: 'Any GGUF model served by llama.cpp. Point at your server URL.',
    badge: 'local',
  },
]

// Provider metadata for the BYOK setup UI.
export interface ProviderMeta {
  id: ProviderId
  name: string
  icon: string // emoji
  // Where the user gets a key.
  keyUrl: string
  // The env-style key prefix for display hints.
  keyPrefixHint: string
  // Default base URL (null = provider default).
  defaultBaseUrl: string | null
  // Whether the base URL is configurable (for Azure, OpenRouter, proxies).
  configurableBaseUrl: boolean
  // Short help text shown in the BYOK dialog.
  help: string
}

export const PROVIDER_META: Record<ProviderId, ProviderMeta> = {
  apical: {
    id: 'apical', name: 'Apical', icon: '◆', keyUrl: '', keyPrefixHint: '',
    defaultBaseUrl: null, configurableBaseUrl: false, help: 'Hosted models — no key needed.',
  },
  openai: {
    id: 'openai', name: 'OpenAI', icon: '🟢', keyUrl: 'https://platform.openai.com/api-keys',
    keyPrefixHint: 'sk-...', defaultBaseUrl: 'https://api.openai.com/v1', configurableBaseUrl: true,
    help: 'Create a key at platform.openai.com/api-keys. Paste the whole sk-... string.',
  },
  anthropic: {
    id: 'anthropic', name: 'Anthropic', icon: '🟣', keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPrefixHint: 'sk-ant-...', defaultBaseUrl: 'https://api.anthropic.com', configurableBaseUrl: true,
    help: 'Create a key at console.anthropic.com. Paste the whole sk-ant-... string.',
  },
  google: {
    id: 'google', name: 'Google', icon: '🔵', keyUrl: 'https://aistudio.google.com/app/apikey',
    keyPrefixHint: 'AIza...', defaultBaseUrl: null, configurableBaseUrl: false,
    help: 'Create an API key at aistudio.google.com. Paste the whole AIza... string.',
  },
  azure_openai: {
    id: 'azure_openai', name: 'Azure OpenAI', icon: '🔷', keyUrl: '',
    keyPrefixHint: '', defaultBaseUrl: '', configurableBaseUrl: true,
    help: 'Set the base URL to https://{resource}.openai.azure.com and the key to your Azure key.',
  },
  openrouter: {
    id: 'openrouter', name: 'OpenRouter', icon: '🟠', keyUrl: 'https://openrouter.ai/keys',
    keyPrefixHint: 'sk-or-...', defaultBaseUrl: 'https://openrouter.ai/api/v1', configurableBaseUrl: true,
    help: 'OpenRouter routes to many providers. Create a key at openrouter.ai/keys.',
  },
  mistral: {
    id: 'mistral', name: 'Mistral', icon: '🟤', keyUrl: 'https://console.mistral.ai/api-keys',
    keyPrefixHint: '', defaultBaseUrl: 'https://api.mistral.ai/v1', configurableBaseUrl: true,
    help: 'Mistral models. Create a key at console.mistral.ai.',
  },
  groq: {
    id: 'groq', name: 'Groq', icon: '⚫', keyUrl: 'https://console.groq.com/keys',
    keyPrefixHint: 'gsk_...', defaultBaseUrl: 'https://api.groq.com/openai/v1', configurableBaseUrl: true,
    help: 'Ultra-fast inference. Create a key at console.groq.com.',
  },
  together: {
    id: 'together', name: 'Together', icon: '🟣', keyUrl: 'https://api.together.xyz/settings/api-keys',
    keyPrefixHint: '', defaultBaseUrl: 'https://api.together.xyz/v1', configurableBaseUrl: true,
    help: 'Hosted open models. Create a key at api.together.xyz.',
  },
  deepseek: {
    id: 'deepseek', name: 'DeepSeek', icon: '🔵', keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPrefixHint: 'sk-...', defaultBaseUrl: 'https://api.deepseek.com/v1', configurableBaseUrl: true,
    help: 'DeepSeek models. Create a key at platform.deepseek.com.',
  },
  ollama: {
    id: 'ollama', name: 'Ollama', icon: '🦙', keyUrl: 'https://ollama.com',
    keyPrefixHint: '(no key)', defaultBaseUrl: 'http://localhost:11434', configurableBaseUrl: true,
    help: 'Runs on your machine. Install from ollama.com. No API key required.',
  },
  llamacpp: {
    id: 'llamacpp', name: 'llama.cpp', icon: '🔧', keyUrl: 'https://github.com/ggerganov/llama.cpp',
    keyPrefixHint: '(no key)', defaultBaseUrl: 'http://localhost:8080', configurableBaseUrl: true,
    help: 'A GGUF server you run yourself. Point at its OpenAI-compatible URL.',
  },
  vllm: {
    id: 'vllm', name: 'vLLM', icon: '⚡', keyUrl: 'https://docs.vllm.ai',
    keyPrefixHint: '(no key)', defaultBaseUrl: 'http://localhost:8000', configurableBaseUrl: true,
    help: 'A vLLM inference server you run yourself. OpenAI-compatible endpoint.',
  },
}

export function getModel(id: string): ModelDefinition | undefined {
  return MODEL_REGISTRY.find((m) => m.id === id)
}

export function getProvider(id: ProviderId): ProviderMeta {
  return PROVIDER_META[id]
}

// List models available to a user given their plan + BYOK keys + local setup.
// `byokProviders` = the providers the user has keys for.
// `allowLocal` = whether local models are allowed (plan-gated).
export function availableModels(
  byokProviders: ProviderId[],
  allowLocal: boolean,
): ModelDefinition[] {
  return MODEL_REGISTRY.filter((m) => {
    if (m.tier === 'hosted') return true
    if (m.tier === 'local') return allowLocal
    if (m.tier === 'byok') return byokProviders.includes(m.provider)
    return false
  })
}
