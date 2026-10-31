/**
 * Model-fallback plugin for DeepSeek Harness.
 *
 * DeepSeek fixes an agent's model when it prepares a step, and keeps it for
 * every retry of that step; a plugin may only change it with
 * `agent.model.select()`, which applies from the next step. So:
 *
 * 1. A request fails and llm-retry gives up. The step still fails, as before,
 *    but the plugin selects the next backup in the chain, so the agent's next
 *    step or turn (the Manager's or your resend) runs on the backup.
 * 2. Outage memory (per mount): on a provider-side failure (rate limit,
 *    server, timeout, transport, overloaded), other agents on the same model
 *    move to the backup at their next safe point instead of each paying for
 *    the same failed retries. One agent's bad prompt does not count.
 * 3. Once a step has run on the backup and `cooldownMs` (default 5 minutes)
 *    has passed, the agent goes back to its primary. If you change an agent's
 *    model yourself, the plugin leaves that agent alone from then on.
 *
 * Safe points are the start of each step (affects the step after it) and the
 * end of each turn (affects the next turn). After a restart the plugin forgets
 * its switches, so an agent left on a backup stays there until you change it.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision, RequestErrorAction } from '@deepseek-ai/dsh-agent'
import { OUTAGE_CODES, backupSelection, chainFor, onFailure, onSafePoint, parseConfig, sameSelection, selectionKey } from './core.ts'
import type { FallbackConfig, FallbackState, Selection } from './core.ts'

export const name = 'model-fallback'

export type Config = FallbackConfig

export function apply(ctx: Context, config: Config): void {
  const parsed = parseConfig(config)
  /** Outage memory for this mount: primary "provider/model" -> failing until (ms). */
  const outages = new Map<string, number>()
  const states = new WeakMap<Agent, FallbackState>()
  /** The selection each agent's current step was fixed on (from the pre-step payload). */
  const stepSelections = new WeakMap<Agent, Selection>()
  /** Agents whose model the user changed: never moved by outage memory again. */
  const manual = new WeakSet<Agent>()

  const current = (agent: Agent): Selection | undefined => agent.model.current() as Selection | undefined

  function select(agent: Agent, selection: Selection, why: string): void {
    agent.model.select(selection)
    ctx.logger.info(`model-fallback: agent ${agent.id} -> ${selectionKey(selection)} (${why})`)
  }

  /** Restore, forget, or follow a known outage. Takes effect from the next step. */
  function safePoint(agent: Agent): void {
    const now = Date.now()
    const state = states.get(agent)
    const sel = current(agent)
    if (state) {
      const d = onSafePoint(parsed, state, sel, now)
      if (d.kind === 'forget') {
        states.delete(agent)
        manual.add(agent)
      } else if (d.kind === 'restore' && (outages.get(selectionKey(state.primary)) ?? 0) <= now) {
        states.delete(agent)
        select(agent, d.selection, 'cooldown over, back to primary')
      }
      return
    }
    if (!sel || manual.has(agent)) return
    if ((outages.get(selectionKey(sel)) ?? 0) <= now) return
    const chain = chainFor(parsed, sel)
    if (!chain) return
    const backup = backupSelection(sel, chain, 0)
    states.set(agent, { primary: sel, selected: backup, index: 0, since: now, exhausted: false, used: false })
    select(agent, backup, `${selectionKey(sel)} failed recently for another agent`)
  }

  // Let llm-retry (and anything else) decide first; act only when nobody retries.
  ctx.on('agent/request-error', async ({ agent, failure, signal }, next): Promise<RequestErrorAction> => {
    const downstream = await next()
    if (downstream?.kind === 'retry' || signal.aborted) return downstream
    // The model that actually failed is the one this step was fixed on, not a pending selection.
    const failed = stepSelections.get(agent) ?? current(agent)
    if (!failed) return downstream
    const now = Date.now()
    const decision = onFailure(parsed, states.get(agent), failed, failure.code, now)
    if (decision.kind === 'select') {
      states.set(agent, decision.state)
      if (OUTAGE_CODES.has(failure.code)) outages.set(selectionKey(failed), now + parsed.cooldownMs)
      select(agent, decision.selection, `${selectionKey(failed)} failed with ${failure.code}`)
    } else if (decision.kind === 'exhausted') {
      states.set(agent, decision.state)
      ctx.logger.warn(`model-fallback: every backup for ${selectionKey(decision.state.primary)} failed (${failure.code}); staying on ${selectionKey(failed)}`)
    }
    // The failing step ends as it would have; the switch applies from the next step.
    return downstream
  })

  ctx.on('agent/pre-step', ({ agent, modelSelection }, next): Promise<PreStepDecision> => {
    const fixed = modelSelection as Selection | undefined
    if (fixed) {
      stepSelections.set(agent, fixed)
      const state = states.get(agent)
      // The cooldown starts once a step really runs on the backup.
      if (state && !state.used && sameSelection(state.selected, fixed)) {
        state.used = true
        state.since = Date.now()
      }
    }
    safePoint(agent)
    return next()
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    safePoint(agent)
  })
}
