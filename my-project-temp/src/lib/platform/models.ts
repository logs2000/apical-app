// Apical model registry — the catalog of every model the LLM gateway can
// route to. Two tiers:
//   1. Hosted — we hold the provider API key in our environment
//      (OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, XAI_API_KEY).
//      We pay the provider wholesale; the user pays us retail. A hosted model
//      is only offered to users when its provider's key is present in our env;
//      otherwise it is hidden entirely.
//   2. BYOK (user's own key) — the user pays the provider directly. Free to
//      route through Apical; we just meter for the dashboard (cost = 0).
//   3. Local (self-hosted Ollama / llama.cpp / vLLM) — runs on the user's
//      machine (or the desktop bridge). No per-token cost.
//
// The Models settings page reads this registry + the user's CustomModel rows
// to render the picker. The LLM gateway resolves a modelId → adapter.

export type ProviderId =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'xai'
  | 'azure_openai'
  | 'openrouter'
  | 'mistral'
  | 'groq'
  | 'together'
  | 'ollama'
  | 'llamacpp'
  | 'vllm'

// The hosted providers Apical can bill on the user's behalf, in priority order.
// A model from one of these providers is only available when the matching
// API key is present in our environment.
export const HOSTED_PROVIDERS: ProviderId[] = ['openai', 'anthropic', 'google', 'xai']

export type ModelTier = 'hosted' | 'byok' | 'local'

export interface ModelDefinition {
  id: string // canonical id, e.g. "openai:gpt-4o", "anthropic:claude-3-5-sonnet"
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
// Every provider model is `hosted`: Apical holds the provider key in its env and
// bills the user for usage. A model is only shown to a user when its provider's
// API key is present in our environment (see availableModels / listAvailableModels).
export const MODEL_REGISTRY: ModelDefinition[] = [
  // ---- OpenAI (hosted) ----
  {
    id: 'openai:gpt-4o',
    name: 'GPT-4o',
    provider: 'openai',
    tier: 'hosted',
    apiModelId: 'gpt-4o',
    contextWindow: 128_000,
    inputCostCentsPer1M: 250,
    outputCostCentsPer1M: 1000,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'OpenAI flagship multimodal model. Balanced quality and speed.',
    badge: 'powerful',
  },
  {
    id: 'openai:gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'openai',
    tier: 'hosted',
    apiModelId: 'gpt-4o-mini',
    contextWindow: 128_000,
    inputCostCentsPer1M: 15,
    outputCostCentsPer1M: 60,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Fast + cheap. Great default for high-volume tool steps.',
    badge: 'fast',
  },
  {
    id: 'openai:o1',
    name: 'o1',
    provider: 'openai',
    tier: 'hosted',
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

  // ---- Anthropic (hosted) ----
  {
    id: 'anthropic:claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'anthropic',
    tier: 'hosted',
    apiModelId: 'claude-sonnet-4-6',
    contextWindow: 200_000,
    inputCostCentsPer1M: 300,
    outputCostCentsPer1M: 1500,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Anthropic flagship. Excellent at long-context reasoning + tool use.',
    badge: 'powerful',
  },
  {
    id: 'anthropic:claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'anthropic',
    tier: 'hosted',
    apiModelId: 'claude-haiku-4-5-20251001',
    contextWindow: 200_000,
    inputCostCentsPer1M: 80,
    outputCostCentsPer1M: 400,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Fast + affordable Anthropic model. Good default for agent loops.',
    badge: 'fast',
  },

  // ---- Google (hosted) ----
  {
    id: 'google:gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'google',
    tier: 'hosted',
    apiModelId: 'gemini-2.0-flash',
    contextWindow: 1_000_000,
    inputCostCentsPer1M: 100,
    outputCostCentsPer1M: 400,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'Google 1M-context model. Great for ingesting huge documents.',
    badge: 'fast',
  },
  {
    id: 'google:gemini-1.5-pro',
    name: 'Gemini 1.5 Pro',
    provider: 'google',
    tier: 'hosted',
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

  // ---- xAI / Grok (hosted) ----
  {
    id: 'xai:grok-4',
    name: 'Grok 4',
    provider: 'xai',
    tier: 'hosted',
    apiModelId: 'grok-4',
    contextWindow: 256_000,
    inputCostCentsPer1M: 300,
    outputCostCentsPer1M: 1500,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: true,
    description: 'xAI flagship. Strong reasoning with up-to-date world knowledge.',
    badge: 'powerful',
  },
  {
    id: 'xai:grok-3-mini',
    name: 'Grok 3 mini',
    provider: 'xai',
    tier: 'hosted',
    apiModelId: 'grok-3-mini',
    contextWindow: 131_072,
    inputCostCentsPer1M: 30,
    outputCostCentsPer1M: 50,
    supportsStreaming: true,
    supportsTools: true,
    supportsVision: false,
    description: 'Fast + low-cost xAI model. Good for high-volume agent steps.',
    badge: 'fast',
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

  // ---- Local (llama.cpp) ----
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
  xai: {
    id: 'xai', name: 'xAI (Grok)', icon: '✖', keyUrl: 'https://console.x.ai',
    keyPrefixHint: 'xai-...', defaultBaseUrl: 'https://api.x.ai/v1', configurableBaseUrl: true,
    help: 'Grok models from xAI. Create a key at console.x.ai. Paste the whole xai-... string.',
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

// List built-in models available given which hosted providers we have env keys
// for + the plan's local-model allowance.
// `hostedProviders` = providers whose API key is present in our environment.
//   A hosted model is hidden entirely when its provider key is missing.
// `allowLocal` = whether local models are allowed (plan-gated).
export function availableModels(
  hostedProviders: ProviderId[],
  allowLocal: boolean,
): ModelDefinition[] {
  return MODEL_REGISTRY.filter((m) => {
    if (m.tier === 'hosted') return hostedProviders.includes(m.provider)
    if (m.tier === 'local') return allowLocal
    // No built-in BYOK models anymore; BYOK lives in CustomModel rows.
    return false
  })
}
