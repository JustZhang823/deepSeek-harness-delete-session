import assert from 'node:assert/strict'
import test from 'node:test'

import { findAgentRelease } from '../agent-lifecycle.js'

const EFFECT_META = Symbol.for('cordis.effect')

function fixture() {
  const events = []
  const rawDispose = () => { events.push('scope disposed') }
  rawDispose[EFFECT_META] = { label: 'ctx.plugin()', children: [] }
  let pending
  const dispose = () => pending ??= (async () => {
    events.push('driver drained')
    await rawDispose()
    events.push('writer closed')
    events.push('agent detached')
    events.push('session detached')
  })()
  dispose[EFFECT_META] = { label: 'agentLoop.scope(session-test)', children: [rawDispose[EFFECT_META]] }
  const effects = new Set([dispose])
  const agent = {
    id: 'session-test',
    scope: { rawDispose },
    ctx: { fiber: { parent: { fiber: { _disposables: effects } } } },
  }
  return { agent, dispose, effects, events, rawDispose }
}

function assertUnavailable(operation) {
  assert.throws(operation, { code: 'AGENT_RELEASE_UNAVAILABLE' })
}

test('selects the complete lifecycle capability without disposing the bare scope', async () => {
  const fx = fixture()
  const release = findAgentRelease(fx.agent)
  assert.equal(release, fx.dispose)
  assert.deepEqual(fx.events, [])

  await Promise.all([release(), release()])
  assert.deepEqual(fx.events, [
    'driver drained', 'scope disposed', 'writer closed', 'agent detached', 'session detached',
  ])
})

test('ignores effects with another identity even when their labels match', () => {
  const fx = fixture()
  const unrelated = () => assert.fail('unrelated Agent released')
  unrelated[EFFECT_META] = {
    label: 'agentLoop.scope(session-test)',
    children: [{ ...fx.rawDispose[EFFECT_META] }],
  }
  fx.effects.add(unrelated)
  assert.equal(findAgentRelease(fx.agent), fx.dispose)

  fx.effects.delete(fx.dispose)
  assertUnavailable(() => findAgentRelease(fx.agent))
  assert.deepEqual(fx.events, [])
})

test('fails closed for missing or changed Host lifecycle structures', () => {
  const fx = fixture()
  for (const agent of [undefined, {}, { id: 'session-test' }, { ...fx.agent, id: '' }]) {
    assertUnavailable(() => findAgentRelease(agent))
  }
  delete fx.rawDispose[EFFECT_META]
  assertUnavailable(() => findAgentRelease(fx.agent))
  assert.deepEqual(fx.events, [])
})

test('refuses an ambiguous lifecycle rather than choosing an arbitrary disposer', () => {
  const fx = fixture()
  const duplicate = () => assert.fail('ambiguous Agent released')
  duplicate[EFFECT_META] = fx.dispose[EFFECT_META]
  fx.effects.add(duplicate)
  assertUnavailable(() => findAgentRelease(fx.agent))
  assert.deepEqual(fx.events, [])
})

test('reports inaccessible Host internals as release unavailable', () => {
  const fx = fixture()
  const cause = new Error('Host internals changed')
  fx.agent.ctx.fiber.parent.fiber._disposables = {
    [Symbol.iterator]() { throw cause },
  }
  assert.throws(() => findAgentRelease(fx.agent), (error) => {
    assert.equal(error.code, 'AGENT_RELEASE_UNAVAILABLE')
    assert.equal(error.cause, cause)
    return true
  })
  assert.deepEqual(fx.events, [])
})
