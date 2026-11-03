// Fake DeepSeek Harness host, v2. Mirrors semantics read from the real source:
// - cordis waterfall: listeners run outermost-first in registration order; each gets next(); not calling next() vetoes; next() twice throws.
// - cordis serial: listeners awaited in order.
// - tool registry: duplicate name throws `tool "<name>" is already registered in this scope`.
// - agentPresets.composedPreset(agentCtx) returns the agent's preset id.
// - Model selection (core/agent/src/model-selection.ts): agent.model.current() = pending ?? lastUsed ?? options;
//   agent.model.select(sel) records a pending selection used from the NEXT step.
// - Step fixing (core/agent-loop/src/agent.ts): a step's selection is read once at step start and kept for every
//   retry in that step; if an 'agent/request' listener proposes another provider/model the host THROWS.
// - Message kinds: a Manager's first task to a child arrives as 'user'; follow-ups as 'agent-message'
//   (with senderSessionId); a finished child reaches its parent as 'subagent-settled'. Content is [{type:'text',text}].
export function createHost({ presets = {} } = {}) {
  const listeners = {}
  const tools = new Map()
  const logs = []
  const ctx = {
    tools: {
      register(t) {
        if (tools.has(t.name)) throw new Error(`tool "${t.name}" is already registered in this scope`)
        tools.set(t.name, t)
        return () => tools.delete(t.name)
      },
    },
    on(event, fn, prepend = false) {
      const list = (listeners[event] ??= [])
      prepend ? list.unshift(fn) : list.push(fn)
      return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) }
    },
    get(name) {
      if (name === 'agentPresets') return { composedPreset: c => presets[c?.agentId] }
      return undefined
    },
    logger: { info: (...a) => logs.push(['info', ...a]), warn: (...a) => logs.push(['warn', ...a]) },
  }
  function waterfall(event, payload, inner) {
    const callbacks = [...(listeners[event] ?? [])]
    const dispatch = () => {
      const cb = callbacks.shift()
      if (!cb) return inner()
      let called = false
      const next = () => { if (called) throw new Error('next() called multiple times'); called = true; return dispatch() }
      return cb(payload, next)
    }
    return dispatch()
  }
  async function serial(event, payload) {
    for (const cb of [...(listeners[event] ?? [])]) await cb(payload)
  }
  return { ctx, tools, listeners, logs, waterfall, serial }
}

/** An agent with a preset id, a model selection like the real one, and steer(). */
export function createAgent(agentId, { provider = 'deepseek', model = 'deepseek-v4-pro' } = {}) {
  const steered = []
  let pending = null
  let lastUsed = null
  const options = { provider, model }
  const selections = []
  const agent = {
    id: agentId, agentId, ctx: { agentId }, steered, selections,
    steer(m) { steered.push(m) },
    model: {
      current() { const s = pending ?? lastUsed ?? options; return { ...s } },
      select(sel) {
        const cur = pending ?? lastUsed
        if (cur && cur.provider === sel.provider && cur.model === sel.model) return
        pending = { provider: sel.provider, model: sel.model }
        selections.push({ ...pending })
      },
    },
    /** Host side: a request with this selection was sent (folds pending into lastUsed). */
    _used(sel) { lastUsed = { ...sel }; if (pending && pending.provider === sel.provider && pending.model === sel.model) pending = null },
  }
  return agent
}

/** Stand-in for @deepseek-ai/dsh-llm-retry, normal mode: retries listed codes up to maxRetries per step, then delegates. */
export function mountLlmRetry(host, { maxRetries = 2, codes = ['RATE_LIMIT', 'SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE'] } = {}) {
  const counts = new Map()
  host.ctx.on('agent/request-error', async (p, next) => {
    if (!codes.includes(p.failure.code)) return next()
    const key = `${p.agent.id}:${p.turn}:${p.step}`
    const n = counts.get(key) ?? 0
    if (n >= maxRetries) return next()
    counts.set(key, n + 1)
    return { kind: 'retry' }
  })
}

const text = t => [{ type: 'text', text: t }]
export const msg = {
  user: t => ({ source: { kind: 'user' }, content: text(t) }),
  agent: (t, sender = 'manager-1') => ({ source: { kind: 'agent-message', senderSessionId: sender }, content: text(t) }),
  settled: (t, sender = 'child-1') => ({ source: { kind: 'subagent-settled', form: 'notice', senderSessionId: sender }, content: text(t) }),
  notice: (kind, t = '') => ({ source: { kind }, content: text(t) }),
}

/**
 * Simulate the agent loop. step() fixes the selection at step start, runs pre-step, then for each planned outcome
 * runs agent/request (throws like the real host if a listener changes provider/model) and, on failure, agent/request-error.
 * outcomes: array like ['SERVER','SERVER','ok']. Returns { selection, attempts, result: 'ok' | 'error:<code>' }.
 */
export async function step(host, agent, { turn = 1, step: stepNo = 1, messages = [], outcomes = ['ok'] } = {}) {
  const selection = agent.model.current()
  const signal = new AbortController().signal
  await host.waterfall('agent/pre-step', { agent, messages, turn, step: stepNo, signal, modelSelection: selection }, async () => ({ kind: 'continue' }))
  let attempts = 0
  for (const outcome of outcomes) {
    attempts++
    const proposed = await host.waterfall('agent/request', { agent, turn, step: stepNo, signal }, async () => ({ ...selection }))
    if (proposed.provider !== selection.provider || proposed.model !== selection.model) {
      throw new Error(`agent/request proposed "${proposed.provider}/${proposed.model}" after step preparation fixed "${selection.provider}/${selection.model}"`)
    }
    agent._used(selection)
    if (outcome === 'ok') return { selection, attempts, result: 'ok' }
    const action = await host.waterfall('agent/request-error', { agent, turn, step: stepNo, provider: selection.provider, failure: { code: outcome, message: outcome }, retryPolicy: {}, signal }, async () => undefined)
    if (action?.kind !== 'retry') return { selection, attempts, result: `error:${outcome}` }
  }
  return { selection, attempts, result: 'error:out-of-outcomes' }
}

export const loop = {
  preStep: (host, agent, messages, turn = 1) =>
    host.waterfall('agent/pre-step', { agent, messages, turn, step: 1, signal: new AbortController().signal, modelSelection: agent.model.current() }, async () => ({ kind: 'continue' })),
  stop: (host, agent, turn = 1) => host.serial('agent/turn-stopping', { agent, turn, signal: new AbortController().signal }),
  tool: (host, name, args, agent) => {
    const t = host.tools.get(name)
    if (!t) throw new Error(`no tool ${name}`)
    return t.execute(args, { agent, signal: new AbortController().signal })
  },
}
