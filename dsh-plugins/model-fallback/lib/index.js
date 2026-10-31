// Generated from src/index.ts by build.mjs. Do not edit.
/**
 * Model-fallback plugin for DeepSeek Harness.
 *
 * DeepSeek fixes an agent's model when it prepares a step, and keeps it for
 * every retry of that step; a plugin may only change it with
 * `agent.model.select()` before the next step. So this plugin works per turn:
 *
 * 1. A request fails and llm-retry gives up. The step still fails, as before,
 *    but the plugin selects the next backup in the chain, so the next turn
 *    (the Manager's or your resend) runs on the backup.
 * 2. Outage memory: other agents on the same primary are moved to the backup
 *    at their next safe point instead of each rediscovering the outage.
 * 3. After `cooldownMs` (default 5 minutes) the agent goes back to its primary.
 *    If you changed the model yourself, the plugin leaves your choice alone.
 *
 * Every switch costs nothing by itself; every request on a backup is billed.
 * After a restart the plugin forgets its switches, so an agent left on a
 * backup stays there until you change it.
 */

                                                  
                                                                                        
import { backupSelection, chainFor, onFailure, onSafePoint, parseConfig, selectionKey } from './core.js'
                                                                         

export const name = 'model-fallback'

                                   

/** Outage memory shared by every agent: primary "provider/model" -> failing until (ms). */
const outages = new Map                ()
const states = new WeakMap                      ()

export function apply(ctx         , config        )       {
  const parsed = parseConfig(config)

  const current = (agent       )                        => agent.model.current()                         

  function select(agent       , selection           , why        )       {
    agent.model.select(selection)
    ctx.logger.info(`model-fallback: agent ${agent.id} -> ${selectionKey(selection)} (${why})`)
  }

  /** Before the next step is prepared: restore, forget, or follow a known outage. */
  function safePoint(agent       )       {
    const now = Date.now()
    const state = states.get(agent)
    const sel = current(agent)
    if (state) {
      const d = onSafePoint(parsed, state, sel, now)
      if (d.kind === 'forget') states.delete(agent)
      else if (d.kind === 'restore' && (outages.get(selectionKey(state.primary)) ?? 0) <= now) {
        states.delete(agent)
        select(agent, d.selection, 'cooldown over, back to primary')
      }
      return
    }
    if (!sel) return
    const until = outages.get(selectionKey(sel)) ?? 0
    if (until <= now) return
    const chain = chainFor(parsed, sel)
    if (!chain) return
    const backup = backupSelection(sel, chain, 0)
    states.set(agent, { primary: sel, selected: backup, index: 0, since: now, exhausted: false })
    select(agent, backup, `${selectionKey(sel)} failed recently for another agent`)
  }

  // Let llm-retry (and anything else) decide first; act only when nobody retries.
  ctx.on('agent/request-error', async ({ agent, failure, signal }, next)                              => {
    const downstream = await next()
    if (downstream?.kind === 'retry' || signal.aborted) return downstream
    const sel = current(agent)
    if (!sel) return downstream
    const now = Date.now()
    const decision = onFailure(parsed, states.get(agent), sel, failure.code, now)
    if (decision.kind === 'select') {
      states.set(agent, decision.state)
      outages.set(selectionKey(decision.state.primary), now + parsed.cooldownMs)
      select(agent, decision.selection, `${selectionKey(sel)} failed with ${failure.code}; used from the next turn`)
    } else if (decision.kind === 'exhausted') {
      states.set(agent, decision.state)
      ctx.logger.warn(`model-fallback: every backup for ${selectionKey(decision.state.primary)} failed (${failure.code}); staying on ${selectionKey(sel)}`)
    }
    // The failing step ends as it would have; the switch applies from the next step.
    return downstream
  })

  // Safe points: between steps and at turn boundaries, before the next step is prepared.
  ctx.on('agent/pre-step', ({ agent }, next)                           => {
    safePoint(agent)
    return next()
  })
  ctx.on('agent/turn-stopping', ({ agent }) => {
    safePoint(agent)
  })
}
