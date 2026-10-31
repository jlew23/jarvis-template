/**
 * Pure logic for the model-fallback plugin: config parsing, chain lookup, and
 * the decisions the plugin makes at each hook. No harness imports.
 */

export interface ModelRef {
  provider?: string
  model: string
}

export interface Selection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface FallbackConfig {
  /** Primary model id (or provider/model) -> ordered backups. */
  chains: Record<string, string[]>
  /** Failure codes that trigger a switch. Default: transient errors. [] = any failure. */
  codes?: string[]
  /** How long to stay on a backup before trying the primary again (default 5 minutes). */
  cooldownMs?: number
}

export const DEFAULT_CODES = ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'OVERLOADED']
/** Only provider-side failures say the model is down for everyone; one agent's bad prompt does not. */
export const OUTAGE_CODES = new Set(['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'OVERLOADED'])
export const DEFAULT_COOLDOWN_MS = 5 * 60_000

const PREFIX = 'model-fallback config'

/**
 * "provider/model" or "model". The first "/" splits provider from model, so a
 * model id that itself contains "/" must be written with its provider.
 */
export function parseRef(text: unknown, where: string): ModelRef {
  if (typeof text !== 'string') throw new Error(`${PREFIX}: ${where} must be a text model id, got ${JSON.stringify(text)}`)
  const value = text.trim()
  if (value === '') throw new Error(`${PREFIX}: ${where} is empty`)
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
  cooldownMs: number
}

export function parseConfig(config: FallbackConfig): ParsedConfig {
  if (config === null || typeof config !== 'object' || typeof config.chains !== 'object' || config.chains === null || Array.isArray(config.chains)) {
    throw new Error(`${PREFIX}: chains is required, e.g. { deepseek-v4-pro: [deepseek-flash] }`)
  }
  const chains = new Map<string, ModelRef[]>()
  for (const [primaryText, backups] of Object.entries(config.chains)) {
    const primary = parseRef(primaryText, `chain key ${JSON.stringify(primaryText)}`)
    if (!Array.isArray(backups) || backups.length === 0) throw new Error(`${PREFIX}: chain for ${primaryText} must list at least one backup`)
    const refs = backups.map((b, i) => parseRef(b, `chains.${primaryText}[${i}]`))
    // Compare by model id when either side leaves the provider out.
    const same = (a: ModelRef, b: ModelRef) => a.model === b.model && (!a.provider || !b.provider || a.provider === b.provider)
    refs.forEach((r, i) => {
      if (same(r, primary)) throw new Error(`${PREFIX}: chain for ${primaryText} lists itself at [${i}]`)
      if (refs.slice(0, i).some(o => same(o, r))) throw new Error(`${PREFIX}: chain for ${primaryText} lists ${refKey(r)} twice`)
    })
    chains.set(refKey(primary), refs)
  }
  if (config.codes !== undefined && (!Array.isArray(config.codes) || config.codes.some(c => typeof c !== 'string'))) {
    throw new Error(`${PREFIX}: codes must be a list, e.g. [RATE_LIMIT, SERVER]`)
  }
  const codes = config.codes === undefined ? new Set(DEFAULT_CODES) : config.codes.length === 0 ? undefined : new Set(config.codes)
  const cooldownMs = config.cooldownMs ?? DEFAULT_COOLDOWN_MS
  if (!Number.isFinite(cooldownMs) || cooldownMs < 0) throw new Error(`${PREFIX}: cooldownMs must be a number >= 0`)
  return { chains, codes, cooldownMs }
}

export function chainFor(parsed: ParsedConfig, sel: { provider: string; model: string }): ModelRef[] | undefined {
  return parsed.chains.get(`${sel.provider}/${sel.model}`) ?? parsed.chains.get(sel.model)
}

export function shouldSwitch(parsed: ParsedConfig, code: string): boolean {
  return parsed.codes === undefined || parsed.codes.has(code)
}

export function sameSelection(a: Selection | undefined, b: Selection | undefined): boolean {
  return a !== undefined && b !== undefined && a.provider === b.provider && a.model === b.model
}

export function selectionKey(s: { provider: string; model: string }): string {
  return `${s.provider}/${s.model}`
}

/** Backup selection for chain entry `index`, on the primary's provider unless the entry names one. */
export function backupSelection(primary: Selection, chain: ModelRef[], index: number): Selection {
  const ref = chain[index]!
  return { provider: ref.provider ?? primary.provider, model: ref.model }
}

/** Per-agent fallback record: what we switched from, what we selected, and when. */
export interface FallbackState {
  primary: Selection
  selected: Selection
  index: number
  since: number
  /** True once every backup has failed: no more switching until the primary is restored. */
  exhausted: boolean
  /** True once a step has actually run on `selected`; the cooldown only starts counting then. */
  used: boolean
}

export type Decision =
  | { kind: 'none' }
  | { kind: 'select'; selection: Selection; state: FallbackState }
  | { kind: 'exhausted'; state: FallbackState }

/**
 * After a request failed and nobody retried it: choose the next backup.
 * `current` is the selection the failing step used.
 */
export function onFailure(parsed: ParsedConfig, state: FallbackState | undefined, current: Selection, code: string, now: number): Decision {
  if (!shouldSwitch(parsed, code)) return { kind: 'none' }
  // If the user changed the model since we switched, start over from their choice.
  const live = state && sameSelection(state.selected, current) ? state : undefined
  const primary = live?.primary ?? current
  const chain = chainFor(parsed, primary)
  if (!chain) return { kind: 'none' }
  if (live?.exhausted) return { kind: 'none' }
  const index = live ? live.index + 1 : 0
  if (index >= chain.length) return { kind: 'exhausted', state: { ...(live ?? { primary, selected: current, index: index - 1, since: now, used: true }), exhausted: true } }
  const selection = backupSelection(primary, chain, index)
  return { kind: 'select', selection, state: { primary, selected: selection, index, since: now, exhausted: false, used: false } }
}

/**
 * At a safe point (before the next step is prepared): go back to the primary
 * once the cooldown has passed, unless the user picked another model.
 */
export function onSafePoint(parsed: ParsedConfig, state: FallbackState, current: Selection | undefined, now: number):
  { kind: 'keep' } | { kind: 'forget' } | { kind: 'restore'; selection: Selection } {
  if (current === undefined) return { kind: 'keep' } // no information: keep what we know
  if (!sameSelection(state.selected, current)) return { kind: 'forget' } // user changed the model
  if (!state.used || now - state.since < parsed.cooldownMs) return { kind: 'keep' }
  return { kind: 'restore', selection: state.primary }
}
