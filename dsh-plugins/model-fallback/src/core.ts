/**
 * Pure logic for the model-fallback plugin: parsing the chain config and
 * deciding which model an agent should use next. No harness imports.
 */

export interface ModelRef {
  provider?: string
  model: string
}

export interface FallbackConfig {
  /** Primary model id (or provider/model) -> ordered backups. */
  chains: Record<string, string[]>
  /** Failure codes that trigger a switch. Empty: any failure llm-retry gave up on. */
  codes?: string[]
}

export const DEFAULT_CODES = ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'OVERLOADED']

/** "provider/model" or "model". Model ids may themselves contain "/" after the first segment only when a provider is given. */
export function parseRef(text: string): ModelRef {
  const value = text.trim()
  if (value === '') throw new Error('model-fallback: empty model reference')
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return { model: value }
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) }
}

export function refKey(ref: ModelRef): string {
  return ref.provider ? `${ref.provider}/${ref.model}` : ref.model
}

export interface ParsedConfig {
  chains: Map<string, ModelRef[]>
  codes: Set<string> | undefined
}

export function parseConfig(config: FallbackConfig): ParsedConfig {
  if (config === null || typeof config !== 'object' || typeof config.chains !== 'object' || config.chains === null) {
    throw new Error('model-fallback: `chains` is required, e.g. { "deepseek-v4-pro": ["deepseek-flash"] }')
  }
  const chains = new Map<string, ModelRef[]>()
  for (const [primary, backups] of Object.entries(config.chains)) {
    if (!Array.isArray(backups) || backups.length === 0) throw new Error(`model-fallback: chain for ${primary} must list at least one backup`)
    const refs = backups.map(parseRef)
    const keys = new Set(refs.map(refKey))
    if (keys.size !== refs.length) throw new Error(`model-fallback: chain for ${primary} has duplicates`)
    if (keys.has(refKey(parseRef(primary)))) throw new Error(`model-fallback: chain for ${primary} lists itself`)
    chains.set(refKey(parseRef(primary)), refs)
  }
  const codes = config.codes === undefined ? new Set(DEFAULT_CODES) : config.codes.length === 0 ? undefined : new Set(config.codes)
  return { chains, codes }
}

/** The chain for a request's primary model: exact provider/model first, then model id alone. */
export function chainFor(parsed: ParsedConfig, provider: string, model: string): ModelRef[] | undefined {
  return parsed.chains.get(`${provider}/${model}`) ?? parsed.chains.get(model)
}

export function shouldSwitch(parsed: ParsedConfig, code: string): boolean {
  return parsed.codes === undefined || parsed.codes.has(code)
}

/**
 * Per-agent fallback position. `index` -1 means the primary model; 0.. are
 * backups. `primary` remembers which model the chain belongs to.
 */
export interface FallbackState {
  primaryProvider: string
  primaryModel: string
  index: number
}

/** Advance to the next backup, or return undefined when the chain is used up. */
export function advance(state: FallbackState | undefined, chain: ModelRef[], provider: string, model: string): FallbackState | undefined {
  const current = state ?? { primaryProvider: provider, primaryModel: model, index: -1 }
  const next = current.index + 1
  if (next >= chain.length) return undefined
  return { ...current, index: next }
}

/** The model a request should use, given the agent's state. */
export function resolve(state: FallbackState | undefined, chain: ModelRef[] | undefined, provider: string, model: string): { provider: string; model: string } {
  if (state === undefined || chain === undefined || state.index < 0) return { provider, model }
  const ref = chain[state.index]!
  return { provider: ref.provider ?? state.primaryProvider, model: ref.model }
}
