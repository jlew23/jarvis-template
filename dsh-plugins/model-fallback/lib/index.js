// Generated from src/index.ts by build.mjs. Do not edit.
/**
 * Model-fallback plugin for DeepSeek Harness.
 *
 * When a model request fails and `llm-retry` has given up (its own retries are
 * spent, or the failure is not retryable), switch that agent to the next model
 * in its configured chain and retry the step. The agent goes back to its normal
 * model at the next user or Manager message.
 *
 * Retries cost money: every switch is another billed request. The chain is
 * finite, so the agent stops when the last backup fails.
 */

                                                  
                                                                                        
                                                         
import { advance, chainFor, parseConfig, resolve, shouldSwitch } from './core.js'
                                                              

export const name = 'model-fallback'

                                   

export function apply(ctx         , config        )       {
  const parsed = parseConfig(config)
  const states = new WeakMap                      ()
  /** The provider/model each agent last requested, before our override. */
  const lastPrimary = new WeakMap                                            ()

  // Override the model for agents that are in fallback.
  ctx.on('agent/request', async ({ agent }, next)                         => {
    const callConfig = await next()
    const state = states.get(agent)
    const primary = state ? { provider: state.primaryProvider, model: state.primaryModel } : { provider: callConfig.provider, model: callConfig.model }
    lastPrimary.set(agent, primary)
    const chain = chainFor(parsed, primary.provider, primary.model)
    const target = resolve(state, chain, primary.provider, primary.model)
    if (target.provider === callConfig.provider && target.model === callConfig.model) return callConfig
    return { ...callConfig, provider: target.provider, model: target.model }
  })

  // Let llm-retry (and anything else) decide first; switch only when nobody retries.
  ctx.on('agent/request-error', async ({ agent, failure, signal }, next)                              => {
    const downstream = await next()
    if (downstream?.kind === 'retry' || signal.aborted) return downstream
    if (!shouldSwitch(parsed, failure.code)) return downstream
    const primary = lastPrimary.get(agent)
    if (!primary) return downstream
    const chain = chainFor(parsed, primary.provider, primary.model)
    if (!chain) return downstream
    const nextState = advance(states.get(agent), chain, primary.provider, primary.model)
    if (!nextState) {
      ctx.logger.warn(`model-fallback: every backup for ${primary.model} failed (${failure.code}); stopping`)
      return downstream
    }
    states.set(agent, nextState)
    const target = resolve(nextState, chain, primary.provider, primary.model)
    ctx.logger.info(`model-fallback: ${primary.model} failed with ${failure.code}; retrying on ${target.provider}/${target.model}`)
    return { kind: 'retry' }
  })

  // A new user or Manager message goes back to the primary model.
  ctx.on('agent/pre-step', ({ agent, messages }, next)                           => {
    if (messages.some(m => m.source.kind === 'user')) states.delete(agent)
    return next()
  })
}
