/**
 * Compatibility adapter for the shipped AgentLoop's ordered lifecycle.
 *
 * The Host does not expose an unload-by-id API or retain a public AgentHandle
 * lookup. Disposing an Agent's bare scope does not close its persistence writer
 * or detach its Agent and Session. The factory's enclosing Cordis effect owns
 * that complete teardown. Recognize its exact structure; an unfamiliar Host
 * must refuse release rather than guess or mutate either registry.
 */

const EFFECT_META = Symbol.for('cordis.effect')

function unavailable(cause) {
  const error = new Error('This Host does not expose a recognized lifecycle for releasing the loaded session.')
  error.code = 'AGENT_RELEASE_UNAVAILABLE'
  if (cause !== undefined) error.cause = cause
  return error
}

/**
 * Find the existing AgentLoop effect that drains the Agent, closes its writer,
 * and detaches its Agent and Session in order. Finding it performs no teardown.
 *
 * This deliberately depends on the shipped Host's internal effect layout.
 * Both the label and the exact nested raw-scope metadata identity must match.
 * Never replace this check with a label-only lookup or a bare scope.dispose().
 *
 * @param {object} agent the exact live Agent from the Host registry.
 * @returns {Function} the original awaitable, idempotent lifecycle disposer.
 * @throws {Error} with code AGENT_RELEASE_UNAVAILABLE for unknown layouts.
 */
export function findAgentRelease(agent) {
  try {
    if (typeof agent?.id !== 'string' || agent.id === '') throw unavailable()
    const rawDispose = agent.scope?.rawDispose
    const rawMetadata = typeof rawDispose === 'function' ? rawDispose[EFFECT_META] : undefined
    const effects = agent.ctx?.fiber?.parent?.fiber?._disposables
    if (rawMetadata === null || typeof rawMetadata !== 'object'
      || effects === null || typeof effects?.[Symbol.iterator] !== 'function') {
      throw unavailable()
    }

    const label = `agentLoop.scope(${agent.id})`
    const matches = []
    for (const dispose of effects) {
      if (typeof dispose !== 'function') continue
      const metadata = dispose[EFFECT_META]
      if (metadata?.label === label && Array.isArray(metadata.children)
        && metadata.children.includes(rawMetadata)) {
        matches.push(dispose)
      }
    }
    if (matches.length !== 1) throw unavailable()
    return matches[0]
  } catch (error) {
    if (error?.code === 'AGENT_RELEASE_UNAVAILABLE') throw error
    throw unavailable(error)
  }
}
