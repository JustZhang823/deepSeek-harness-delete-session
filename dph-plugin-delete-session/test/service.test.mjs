import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createService } from '../index.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-delete-service-'))
  const project = join(root, '--Users-test-project--')
  const id = 'session-00000000-0000-4000-8000-000000000000'
  const dir = join(project, id)
  const file = join(dir, 'session.v4.jsonl.zstd')
  await mkdir(dir, { recursive: true })
  await writeFile(file, 'header\n')
  await writeFile(join(dir, 'session.lock'), '')
  const snapshot = {
    header: { id, createdAt: 1794290523803, cwd: '/Users/test/project' },
    formatStatus: 'current',
    eventCount: 4,
    sizeBytes: 100,
    location: { kind: 'jsonl', path: file },
  }
  return { root, id, dir, file, snapshot }
}

function makeContext(fx, overrides = {}) {
  const emits = []
  const listeners = new Map()
  const state = { cacheDeleted: false, detached: 0, leaseOpened: 0, leaseClosed: 0, leaseHeld: false, trace: [] }
  const workspace = {
    sessionIds: [fx.id],
    async detachSession(id) {
      if (!workspace.sessionIds.includes(id)) return
      assert.equal(state.leaseHeld, true, 'ownership remains held through metadata cleanup')
      assert.equal(existsSync(fx.file), false, 'the log is removed before metadata cleanup')
      state.detached += 1
      workspace.sessionIds = workspace.sessionIds.filter((candidate) => candidate !== id)
    },
  }
  const registry = {
    archivedSessionIds: [fx.id],
    pinnedSessionIds: [fx.id],
    list: () => [workspace],
    async unarchiveSession(id) {
      registry.archivedSessionIds = registry.archivedSessionIds.filter((candidate) => candidate !== id)
    },
    async unpinSession(id) {
      registry.pinnedSessionIds = registry.pinnedSessionIds.filter((candidate) => candidate !== id)
    },
  }
  const persistence = {
    async stat(id) {
      return id === fx.id && existsSync(fx.file) ? fx.snapshot : undefined
    },
    async list() {
      return []
    },
    async open(id, access) {
      assert.equal(id, fx.id)
      assert.equal(access, 'write')
      assert.equal(state.leaseHeld, false)
      state.leaseHeld = true
      state.leaseOpened += 1
      state.trace.push('deletion lease acquired')
      let closed = false
      return {
        async close() {
          if (closed) return
          closed = true
          state.leaseHeld = false
          state.leaseClosed += 1
          state.trace.push('deletion lease closed')
        },
      }
    },
  }
  const storageDomain = {
    get(name) {
      if (name !== 'session_projcache') return undefined
      return {
        table(name) {
          if (name !== 'sessions') throw new Error('unexpected table')
          return {
            async delete() {
              assert.equal(state.leaseHeld, true, 'cache deletion requires ownership')
              state.trace.push('cache deleted')
              state.cacheDeleted = true
            },
          }
        },
      }
    },
  }
  const ctx = {
    get(name) {
      if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name]
      switch (name) {
        case 'sessionPersistence': return persistence
        case 'workspaceRegistry': return registry
        case 'storageDomain': return storageDomain
        case 'agents': return undefined
        case 'sessionQuery': return undefined
        default: return undefined
      }
    },
    async waterfall(...args) {
      return typeof overrides.activity === 'function' ? overrides.activity(...args) : overrides.activity ?? []
    },
    on(name, callback) {
      const callbacks = listeners.get(name) ?? []
      callbacks.push(callback)
      listeners.set(name, callbacks)
    },
    emit(name, id) {
      emits.push([name, id])
    },
  }
  return { ctx, state, emits, registry, workspace, persistence, listeners }
}

function makeLoadedAgent(fx, options = {}) {
  const state = { live: true, sessionLive: true, releases: 0, trace: [] }
  let maintenanceDone = Promise.resolve()
  const rawDispose = () => assert.fail('bare scope disposal cannot release an Agent')
  rawDispose[Symbol.for('cordis.effect')] = { label: 'ctx.plugin()', children: [] }
  const agent = {
    id: fx.id,
    status: options.status ?? 'idle',
    phase: { kind: options.phase ?? 'idle' },
    scope: { rawDispose },
    runMaintenance(job) {
      if (agent.phase.kind !== 'idle' || options.maintenanceReject) throw new Error('Agent has active maintenance')
      const done = Promise.withResolvers()
      maintenanceDone = done.promise
      agent.phase = { kind: 'maintenance' }
      return (async () => {
        try {
          return await job()
        } finally {
          agent.phase = { kind: 'idle' }
          state.trace.push('maintenance returned')
          done.resolve()
        }
      })()
    },
  }
  const release = async () => {
    state.releases += 1
    await maintenanceDone
    if (options.releaseError) throw options.releaseError
    state.trace.push('old writer closed')
    if (!options.retainAgent) state.live = false
    if (!options.retainSession) state.sessionLive = false
  }
  release[Symbol.for('cordis.effect')] = {
    label: `agentLoop.scope(${fx.id})`, children: [rawDispose[Symbol.for('cordis.effect')]],
  }
  agent.ctx = { fiber: { parent: { fiber: { _disposables: new Set([release]) } } } }
  return {
    agent,
    state,
    agents: { get: (id) => id === fx.id && state.live ? agent : undefined },
    sessions: { get: (id) => id === fx.id && state.sessionLive ? {} : undefined },
  }
}

test('plan reports archived/pinned state and canDelete for an idle materialized session', async () => {
  const fx = await fixture()
  try {
    const { ctx } = makeContext(fx)
    const service = createService(ctx)
    const result = await service.plan(fx.id)
    assert.equal(result.ok, true)
    assert.equal(result.value.canDelete, true)
    assert.equal(result.value.blocked, null)
    assert.equal(result.value.archived, true)
    assert.equal(result.value.pinned, true)
    assert.equal(result.value.storageKind, 'jsonl')
    assert.equal(result.value.sizeBytes, 100)
    assert.equal(result.value.eventCount, 4)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('deleteSession removes the log, cache, workspace account, archive, pin, and emits removed', async () => {
  const fx = await fixture()
  try {
    const { ctx, state, emits, registry, workspace } = makeContext(fx)
    const service = createService(ctx)
    const result = await service.deleteSession(fx.id, { confirm: true })
    assert.equal(result.ok, true)
    assert.equal(result.value.deleted, true)
    assert.equal(result.value.logDeleted, true)
    assert.equal(result.value.projectionCacheDeleted, true)
    assert.equal(result.value.workspaceDetached, 1)
    assert.equal(result.value.wasArchived, true)
    assert.equal(result.value.wasPinned, true)
    assert.deepEqual(result.value.warnings, [])
    assert.equal(existsSync(fx.dir), false)
    assert.equal(state.cacheDeleted, true)
    assert.deepEqual(workspace.sessionIds, [])
    assert.deepEqual(registry.archivedSessionIds, [])
    assert.deepEqual(registry.pinnedSessionIds, [])
    assert.deepEqual(emits, [['api-session/removed', fx.id]])
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('deleteSession requires explicit confirmation before touching anything', async () => {
  const fx = await fixture()
  try {
    const { ctx, state } = makeContext(fx)
    const service = createService(ctx)
    const result = await service.deleteSession(fx.id, {})
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(existsSync(fx.dir), true)
    assert.equal(state.cacheDeleted, false)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('active work blocks both plan and delete', async () => {
  const fx = await fixture()
  try {
    const active = [{ kind: 'turn' }, { kind: 'job', items: [{ id: 'job-1', label: 'tests' }] }]
    const { ctx, state } = makeContext(fx, { activity: active })
    const service = createService(ctx)
    const plan = await service.plan(fx.id)
    assert.equal(plan.ok, true)
    assert.equal(plan.value.canDelete, false)
    assert.equal(plan.value.blocked.code, 'ACTIVE')
    const result = await service.deleteSession(fx.id, { confirm: true })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'ACTIVE')
    assert.equal(existsSync(fx.dir), true)
    assert.equal(state.cacheDeleted, false)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('a loaded Agent with an unsupported release capability is preserved', async () => {
  const fx = await fixture()
  try {
    const { ctx, state } = makeContext(fx, { agents: { get: () => ({ id: fx.id }) } })
    const service = createService(ctx)
    const result = await service.deleteSession(fx.id, { confirm: true })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'AGENT_RELEASE_UNAVAILABLE')
    assert.equal(existsSync(fx.dir), true)
    assert.equal(state.cacheDeleted, false)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('a missing session is reported as NOT_FOUND', async () => {
  const fx = await fixture()
  try {
    const { ctx } = makeContext(fx)
    const service = createService(ctx)
    const plan = await service.plan('session-11111111-1111-4111-8111-111111111111')
    assert.equal(plan.ok, false)
    assert.equal(plan.error.code, 'NOT_FOUND')
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('plan counts descendant sessions and reports the parent link', async () => {
  const fx = await fixture()
  try {
    const { ctx } = makeContext(fx, {
      sessionQuery: {
        async traceSession() {
          return {
            descendants: [
              { session: { id: 'child-1' }, descendants: [{ session: { id: 'grandchild-1' }, descendants: [] }] },
              { session: { id: 'child-2' }, descendants: [] },
            ],
          }
        },
      },
    })
    const plan = await createService(ctx).plan(fx.id)
    assert.equal(plan.ok, true)
    assert.equal(plan.value.childSessionCount, 3)
    assert.equal(plan.value.parentSessionId, null)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('detach failure after the log is gone is a warning, not a failed delete', async () => {
  const fx = await fixture()
  try {
    const { ctx, persistence } = makeContext(fx)
    const workspace = {
      sessionIds: [fx.id],
      async detachSession() {
        throw new Error('registry write failed')
      },
    }
    ctx.get = (name) => {
      if (name === 'workspaceRegistry') {
        return {
          archivedSessionIds: [],
          pinnedSessionIds: [],
          list: () => [workspace],
          unarchiveSession: async () => {},
          unpinSession: async () => {},
        }
      }
      if (name === 'sessionPersistence') {
        return persistence
      }
      return undefined
    }
    const service = createService(ctx)
    const result = await service.deleteSession(fx.id, { confirm: true })
    assert.equal(result.ok, true)
    assert.equal(result.value.logDeleted, true)
    assert.ok(result.value.warnings.some((warning) => warning.code === 'WORKSPACE_DETACH_FAILED'))
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('preview allows a loaded idle Agent without releasing it or acquiring a writer', async () => {
  const fx = await fixture()
  try {
    const loaded = makeLoadedAgent(fx)
    const { ctx, state } = makeContext(fx, loaded)
    const plan = await createService(ctx).plan(fx.id)
    assert.equal(plan.ok, true)
    assert.equal(plan.value.live, true)
    assert.equal(plan.value.canDelete, true)
    assert.equal(plan.value.blocked, null)
    assert.deepEqual(plan.value.activity, [])
    assert.equal(loaded.state.releases, 0)
    assert.equal(state.leaseOpened, 0)
    assert.equal(existsSync(fx.file), true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('loaded idle deletion closes the old writer before taking exclusive deletion ownership', async () => {
  const fx = await fixture()
  try {
    const loaded = makeLoadedAgent(fx)
    const { ctx, state, persistence } = makeContext(fx, loaded)
    const open = persistence.open
    persistence.open = (...args) => {
      assert.deepEqual(loaded.state.trace, ['maintenance returned', 'old writer closed'])
      assert.equal(loaded.state.live, false)
      assert.equal(loaded.state.sessionLive, false)
      assert.equal(existsSync(fx.file), true)
      return open(...args)
    }
    const result = await createService(ctx).deleteSession(fx.id, { confirm: true })
    assert.equal(result.ok, true)
    assert.equal(result.value.agentReleased, true)
    assert.equal(loaded.state.releases, 1)
    assert.deepEqual(state.trace, ['deletion lease acquired', 'cache deleted', 'deletion lease closed'])
    assert.equal(state.leaseClosed, 1)
    assert.equal(state.leaseHeld, false)
    assert.equal(existsSync(fx.dir), false)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('running turns and active maintenance block deletion even without activity providers', async () => {
  for (const options of [{ status: 'running', phase: 'running' }, { status: 'idle', phase: 'maintenance' }]) {
    const fx = await fixture()
    try {
      const loaded = makeLoadedAgent(fx, options)
      const { ctx, state } = makeContext(fx, loaded)
      const service = createService(ctx)
      const plan = await service.plan(fx.id)
      assert.equal(plan.value.canDelete, false)
      assert.equal(plan.value.blocked.code, 'ACTIVE')
      const result = await service.deleteSession(fx.id, { confirm: true })
      assert.equal(result.ok, false)
      assert.equal(result.error.code, 'ACTIVE')
      assert.equal(loaded.state.releases, 0)
      assert.equal(state.leaseOpened, 0)
      assert.equal(state.cacheDeleted, false)
      assert.equal(existsSync(fx.file), true)
    } finally {
      await rm(fx.root, { recursive: true, force: true })
    }
  }
})

test('unconfirmed deletion never releases a loaded Agent', async () => {
  const fx = await fixture()
  try {
    const loaded = makeLoadedAgent(fx)
    const { ctx, state } = makeContext(fx, loaded)
    const result = await createService(ctx).deleteSession(fx.id, { confirm: false })
    assert.equal(result.error.code, 'CONFIRMATION_REQUIRED')
    assert.equal(loaded.state.releases, 0)
    assert.equal(state.leaseOpened, 0)
    assert.equal(existsSync(fx.file), true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('failed idle admission does not invoke release or delete stored data', async () => {
  const fx = await fixture()
  try {
    const loaded = makeLoadedAgent(fx, { maintenanceReject: true })
    const { ctx, state } = makeContext(fx, loaded)
    const result = await createService(ctx).deleteSession(fx.id, { confirm: true })
    assert.equal(result.error.code, 'ACTIVE')
    assert.equal(loaded.state.releases, 0)
    assert.equal(state.leaseOpened, 0)
    assert.equal(state.cacheDeleted, false)
    assert.equal(existsSync(fx.file), true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('release failure preserves the log and derived cache', async () => {
  const fx = await fixture()
  try {
    const loaded = makeLoadedAgent(fx, { releaseError: new Error('writer close failed') })
    const { ctx, state } = makeContext(fx, loaded)
    const result = await createService(ctx).deleteSession(fx.id, { confirm: true })
    assert.equal(result.error.code, 'AGENT_RELEASE_FAILED')
    assert.match(result.error.message, /writer close failed/)
    assert.equal(loaded.state.releases, 1)
    assert.equal(state.leaseOpened, 0)
    assert.equal(state.cacheDeleted, false)
    assert.equal(existsSync(fx.file), true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('incomplete release with an Agent or Session still attached refuses deletion', async () => {
  for (const options of [{ retainAgent: true }, { retainSession: true }]) {
    const fx = await fixture()
    try {
      const loaded = makeLoadedAgent(fx, options)
      const { ctx, state } = makeContext(fx, loaded)
      const result = await createService(ctx).deleteSession(fx.id, { confirm: true })
      assert.equal(result.error.code, 'AGENT_RELEASE_FAILED')
      assert.equal(state.leaseOpened, 0)
      assert.equal(state.cacheDeleted, false)
      assert.equal(existsSync(fx.file), true)
    } finally {
      await rm(fx.root, { recursive: true, force: true })
    }
  }
})

test('writer contention preserves the log and derived cache after idle release', async () => {
  const fx = await fixture()
  try {
    const loaded = makeLoadedAgent(fx)
    const { ctx, state, persistence } = makeContext(fx, loaded)
    persistence.open = async () => { throw new Error('SessionAlreadyOwnedError') }
    const result = await createService(ctx).deleteSession(fx.id, { confirm: true })
    assert.equal(result.error.code, 'AGENT_RELEASE_FAILED')
    assert.equal(loaded.state.releases, 1)
    assert.equal(state.cacheDeleted, false)
    assert.equal(existsSync(fx.file), true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('activity discovered under the deletion lease closes ownership and keeps the log', async () => {
  const fx = await fixture()
  try {
    let calls = 0
    const { ctx, state } = makeContext(fx, { activity: () => ++calls === 1 ? [] : [{ kind: 'job' }] })
    const result = await createService(ctx).deleteSession(fx.id, { confirm: true })
    assert.equal(result.error.code, 'ACTIVE')
    assert.equal(state.leaseOpened, 1)
    assert.equal(state.leaseClosed, 1)
    assert.equal(state.leaseHeld, false)
    assert.equal(state.cacheDeleted, false)
    assert.equal(existsSync(fx.file), true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('same-session deletion is serialized and publication/model steps are fenced until ownership closes', async () => {
  const fx = await fixture()
  const started = Promise.withResolvers()
  const proceed = Promise.withResolvers()
  try {
    const { ctx, state, persistence, listeners } = makeContext(fx)
    const originalOpen = persistence.open
    persistence.open = async (...args) => {
      const handle = await originalOpen(...args)
      started.resolve()
      await proceed.promise
      return handle
    }
    const service = createService(ctx)
    const pending = service.deleteSession(fx.id, { confirm: true })
    await started.promise
    const duplicate = await service.deleteSession(fx.id, { confirm: true })
    assert.equal(duplicate.error.code, 'DELETE_IN_PROGRESS')
    const created = listeners.get('agent/created')[0]
    const preStep = listeners.get('agent/pre-step')[0]
    assert.throws(() => created({ agent: { id: fx.id } }), /being deleted/)
    assert.doesNotThrow(() => created({ agent: { id: 'another-session' } }))
    let delegated = 0
    const next = () => { delegated += 1; return Promise.resolve({ kind: 'allow' }) }
    assert.deepEqual(await preStep({ agent: { id: fx.id } }, next), { kind: 'reject' })
    assert.equal(delegated, 0)
    assert.deepEqual(await preStep({ agent: { id: 'another-session' } }, next), { kind: 'allow' })
    proceed.resolve()
    assert.equal((await pending).ok, true)
    assert.equal(state.leaseClosed, 1)
    assert.doesNotThrow(() => created({ agent: { id: fx.id } }))
    assert.deepEqual(await preStep({ agent: { id: fx.id } }, next), { kind: 'allow' })
    assert.equal(delegated, 2)
  } finally {
    proceed.resolve()
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('a deletion lease close failure is a warning after data was successfully deleted', async () => {
  const fx = await fixture()
  try {
    const { ctx, state, persistence, listeners } = makeContext(fx)
    const open = persistence.open
    persistence.open = async (...args) => {
      const handle = await open(...args)
      return {
        async close() {
          await handle.close()
          throw new Error('kernel write lock release failed')
        },
      }
    }
    const result = await createService(ctx).deleteSession(fx.id, { confirm: true })
    assert.equal(result.ok, true)
    assert.equal(result.value.deleted, true)
    assert.equal(existsSync(fx.dir), false)
    assert.equal(state.leaseClosed, 1)
    assert.deepEqual(result.value.warnings, [{
      code: 'WRITE_LEASE_RELEASE_FAILED', message: 'kernel write lock release failed',
    }])
    assert.doesNotThrow(() => listeners.get('agent/created')[0]({ agent: { id: fx.id } }))
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('a deletion lease close failure after refusal reports an error and retains the log', async () => {
  const fx = await fixture()
  try {
    let calls = 0
    const { ctx, state, persistence, listeners } = makeContext(fx, {
      activity: () => ++calls === 1 ? [] : [{ kind: 'job' }],
    })
    const open = persistence.open
    persistence.open = async (...args) => {
      const handle = await open(...args)
      return {
        async close() {
          await handle.close()
          throw new Error('kernel write lock release failed')
        },
      }
    }
    const result = await createService(ctx).deleteSession(fx.id, { confirm: true })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'DELETE_FAILED')
    assert.match(result.error.message, /release deletion ownership.*kernel write lock release failed/)
    assert.equal(existsSync(fx.file), true)
    assert.equal(state.cacheDeleted, false)
    assert.equal(state.leaseClosed, 1)
    assert.doesNotThrow(() => listeners.get('agent/created')[0]({ agent: { id: fx.id } }))
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('loaded deletion revalidates and removes the current generation path under its writer lease', async () => {
  const fx = await fixture()
  try {
    const loaded = makeLoadedAgent(fx)
    const { ctx, state, persistence } = makeContext(fx, {
      ...loaded,
      workspaceRegistry: {
        archivedSessionIds: [], pinnedSessionIds: [], list: () => [],
        unarchiveSession: async () => {}, unpinSession: async () => {},
      },
    })
    const currentDir = join(fx.root, '--Users-current-project--', fx.id)
    const currentFile = join(currentDir, 'session.v5.jsonl.zstd')
    const current = { ...fx.snapshot, location: { kind: 'jsonl', path: currentFile } }
    const observed = []
    persistence.stat = async (id) => {
      assert.equal(id, fx.id)
      const snapshot = state.leaseHeld ? current : fx.snapshot
      observed.push({ held: state.leaseHeld, path: snapshot.location.path })
      return snapshot
    }
    const open = persistence.open
    persistence.open = async (...args) => {
      assert.equal(loaded.state.live, false, 'migration occurs after the old Agent releases its writer')
      const handle = await open(...args)
      await mkdir(currentDir, { recursive: true })
      await writeFile(currentFile, 'current generation\n')
      return handle
    }
    const result = await createService(ctx).deleteSession(fx.id, { confirm: true })
    assert.equal(result.ok, true)
    assert.equal(result.value.agentReleased, true)
    assert.deepEqual(observed, [
      { held: false, path: fx.file },
      { held: true, path: currentFile },
    ])
    assert.equal(existsSync(currentDir), false, 'current generation directory was deleted')
    assert.equal(existsSync(fx.file), true, 'the stale preview location was not deleted')
    assert.equal(state.leaseClosed, 1)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})
