/**
 * Delete Session — Host half.
 *
 * The shipped session manager can archive a Session (hide it) but has no
 * deletion API. This plugin adds one narrow Host operation and a same-origin
 * HTTP bridge for the Web UI. It reuses the existing Session services:
 *
 *   - `sessionPersistence.stat()` discovers the exact JSONL location and
 *     message/event statistics.
 *   - `workspace/session-activity` is the same gate `archiveSession` uses, so a
 *     Session with a running turn, subagent, owned job, or schedule is refused.
 *   - `workspaceRegistry` cleans workspace accounting, archive membership, and
 *     pins through its public entity/registry methods.
 *   - `storageDomain` removes the derived projection-cache record.
 *   - `api-session/removed` tells connected Clients to drop the row.
 *
 * Deletion itself is a filesystem operation on the session-owned directory,
 * validated by `session-files.js`. The Host bridge is protected by a per-process
 * token and same-origin checks. Desktop proxy requests without browser-origin
 * headers must authenticate as the Host's browser Peer before getting a token.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto'
import { deleteSessionDirectory, isSafeSessionId, resolveSessionDirectory, SessionLocationError } from './session-files.js'
import { findAgentRelease } from './agent-lifecycle.js'

/** Hard dependencies: the Web carrier, durable Session seam, and Host admission. */
export const inject = ['webServer', 'sessionPersistence', 'connection']

const ROUTE_PREFIX = '/api/dsh-session-delete'
const TOKEN_HEADER = 'x-dsh-session-delete-token'
const MAX_BODY_BYTES = 64 * 1024

/**
 * @typedef {{ code: string, message: string, details?: Record<string, unknown> }} Failure
 * @typedef {{ ok: true, value: unknown } | { ok: false, error: Failure }} Result
 */

/**
 * @param {string} code stable failure code.
 * @param {string} message operator-facing diagnostic.
 * @param {Record<string, unknown>} [details] structured context.
 * @returns {{ ok: false, error: Failure }}
 */
function failure(code, message, details = undefined) {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } }
}

/**
 * @param {unknown} value candidate session id from the wire.
 * @returns {string | undefined} the id when it is a safe single segment.
 */
function readSessionId(value) {
  if (typeof value !== 'string') return undefined
  return isSafeSessionId(value) ? value : undefined
}

/**
 * Ask the same providers `archiveSession` asks. A composition without providers
 * returns an empty list.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx owning Host context.
 * @param {string} sessionId target Session.
 * @returns {Promise<readonly object[]>} reported activity.
 */
async function activityOf(ctx, sessionId) {
  const result = typeof ctx.waterfall === 'function'
    ? await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
    : []
  if (!Array.isArray(result)) throw new Error('The session activity provider returned an invalid result.')
  const agent = loadedAgent(ctx, sessionId)
  if (agent?.status === 'running' && !result.some((item) => item.kind === 'turn')) return [{ kind: 'turn' }, ...result]
  if (agent?.phase?.kind === 'maintenance') return [{ kind: 'maintenance' }, ...result]
  return result
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx owning Host context.
 * @param {string} sessionId target Session.
 * @returns {object | undefined} the loaded Agent, including an idle one.
 */
function loadedAgent(ctx, sessionId) {
  const agents = ctx.get('agents')
  if (agents === undefined) return undefined
  if (typeof agents.get !== 'function') throw new Error('The Agent registry cannot check session ownership.')
  return agents.get(sessionId)
}

/** Return the exact lifecycle release only when the Agent supports idle admission. */
function idleAgentRelease(agent) {
  if (agent.status !== 'idle' || typeof agent.runMaintenance !== 'function') {
    const error = new Error('This Host cannot safely release the loaded session. Update the plugin or Host and retry.')
    error.code = 'AGENT_RELEASE_UNAVAILABLE'
    throw error
  }
  return findAgentRelease(agent)
}

/**
 * Best-effort title read through the unified query service.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx owning Host context.
 * @param {string} sessionId target Session.
 * @returns {Promise<string>} the persisted title, or an empty string.
 */
async function readTitle(ctx, sessionId) {
  const query = ctx.get('sessionQuery')
  if (query === undefined || typeof query.readTitle !== 'function') return ''
  try {
    const snapshot = await query.readTitle(sessionId)
    return snapshot !== null && typeof snapshot === 'object' && typeof snapshot.title === 'string'
      ? snapshot.title
      : ''
  } catch {
    return ''
  }
}

/**
 * Count descendant Sessions without mutating anything. Prefers the lineage
 * service; falls back to the persistence listing so a profile without the
 * experimental query provider still gets a useful warning.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx owning Host context.
 * @param {string} sessionId target Session.
 * @returns {Promise<number>} descendant count, or 0 when unknown.
 */
async function countDescendants(ctx, sessionId) {
  const query = ctx.get('sessionQuery')
  if (query !== undefined && typeof query.traceSession === 'function') {
    try {
      const trace = await query.traceSession(sessionId)
      return countTree(trace === null || typeof trace !== 'object' ? undefined : trace.descendants)
    } catch {
      // Fall through to the persistence listing.
    }
  }
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined || typeof persistence.list !== 'function') return 0
  try {
    const snapshots = await persistence.list()
    const children = new Map()
    for (const snapshot of snapshots) {
      const parent = snapshot?.header?.parentSession
      if (typeof parent !== 'string') continue
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent).push(snapshot.header.id)
    }
    const seen = new Set()
    const queue = [...(children.get(sessionId) ?? [])]
    while (queue.length > 0) {
      const id = queue.shift()
      if (seen.has(id)) continue
      seen.add(id)
      queue.push(...(children.get(id) ?? []))
    }
    return seen.size
  } catch {
    return 0
  }
}

/**
 * @param {unknown} nodes descendant tree nodes.
 * @returns {number} node count.
 */
function countTree(nodes) {
  if (!Array.isArray(nodes)) return 0
  let count = 0
  for (const node of nodes) {
    count += 1
    if (node !== null && typeof node === 'object') count += countTree(node.descendants)
  }
  return count
}

/**
 * Remove the derived projection-cache record through the domain layer, not by
 * guessing a cache file path. The cache is rebuildable, so a failure is a
 * warning rather than a reason to keep the session log.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx owning Host context.
 * @param {string} sessionId target Session.
 * @returns {Promise<{ attempted: boolean, deleted: boolean, warning?: Failure }>}
 */
async function deleteProjectionCache(ctx, sessionId) {
  const storage = ctx.get('storageDomain')
  if (storage === undefined || typeof storage.get !== 'function') {
    return {
      attempted: false,
      deleted: false,
      warning: { code: 'PROJECTION_CACHE_UNAVAILABLE', message: 'The projection-cache domain is not mounted.' },
    }
  }
  let domain
  try {
    domain = storage.get('session_projcache')
  } catch (error) {
    return {
      attempted: false,
      deleted: false,
      warning: { code: 'PROJECTION_CACHE_UNAVAILABLE', message: messageOf(error) },
    }
  }
  if (domain === undefined || typeof domain.table !== 'function') {
    return {
      attempted: false,
      deleted: false,
      warning: { code: 'PROJECTION_CACHE_UNAVAILABLE', message: 'The projection-cache domain is not open.' },
    }
  }
  let table
  try {
    table = domain.table('sessions')
  } catch (error) {
    return {
      attempted: false,
      deleted: false,
      warning: { code: 'PROJECTION_CACHE_UNAVAILABLE', message: messageOf(error) },
    }
  }
  if (table === null || typeof table !== 'object' || typeof table.delete !== 'function') {
    return {
      attempted: false,
      deleted: false,
      warning: { code: 'PROJECTION_CACHE_UNAVAILABLE', message: 'The projection-cache sessions table cannot delete records.' },
    }
  }
  try {
    await table.delete(sessionId)
    return { attempted: true, deleted: true }
  } catch (error) {
    return {
      attempted: true,
      deleted: false,
      warning: { code: 'PROJECTION_CACHE_FAILED', message: messageOf(error) },
    }
  }
}

/**
 * Remove every workspace account entry, archive membership, and pin. These are
 * idempotent public registry operations; a failure after the log is gone is
 * reported as a warning because the next restart reconciles unknown ids.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx owning Host context.
 * @param {string} sessionId target Session.
 * @returns {Promise<{ workspaceUnavailable: boolean, detached: number, archived: boolean, pinned: boolean, warnings: Failure[] }>}
 */
async function cleanWorkspaceMetadata(ctx, sessionId) {
  const warnings = []
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) {
    warnings.push({
      code: 'WORKSPACE_UNAVAILABLE',
      message: 'The workspace registry is not mounted; workspace membership, archive, and pin metadata were not cleaned.',
    })
    return { workspaceUnavailable: true, detached: 0, archived: false, pinned: false, warnings }
  }

  const wasArchived = Array.isArray(registry.archivedSessionIds)
    ? registry.archivedSessionIds.includes(sessionId)
    : false
  const wasPinned = Array.isArray(registry.pinnedSessionIds)
    ? registry.pinnedSessionIds.includes(sessionId)
    : false

  let detached = 0
  try {
    for (const workspace of registry.list()) {
      const had = Array.isArray(workspace.sessionIds) && workspace.sessionIds.includes(sessionId)
      await workspace.detachSession(sessionId)
      if (had) detached += 1
    }
  } catch (error) {
    warnings.push({ code: 'WORKSPACE_DETACH_FAILED', message: messageOf(error) })
  }

  try {
    await registry.unarchiveSession(sessionId)
  } catch (error) {
    warnings.push({ code: 'UNARCHIVE_FAILED', message: messageOf(error) })
  }

  try {
    await registry.unpinSession(sessionId)
  } catch (error) {
    warnings.push({ code: 'UNPIN_FAILED', message: messageOf(error) })
  }

  return { workspaceUnavailable: false, detached, archived: wasArchived, pinned: wasPinned, warnings }
}

/**
 * @param {unknown} error caught value.
 * @returns {string} a safe message.
 */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx owning Host context.
 * @returns {{ plan: Function, deleteSession: Function }} the Host operation surface.
 */
export function createService(ctx) {
  const deleting = new Set()
  // A resumed Agent must roll back while deletion owns this identity. The
  // persistence writer lease below also excludes opens before publication.
  ctx.on?.('agent/created', ({ agent }) => {
    if (deleting.has(agent.id)) throw new Error('The session is being deleted.')
  })
  ctx.on?.('agent/pre-step', ({ agent }, next) => deleting.has(agent.id)
    ? Promise.resolve({ kind: 'reject' })
    : next(), { prepend: true })
  /**
   * Read-only impact inspection used by the confirmation dialog.
   *
   * @param {string} sessionId target Session.
   * @returns {Promise<Result>} a plan value even when deletion is currently blocked.
   */
  async function plan(sessionId) {
    if (!isSafeSessionId(sessionId)) return failure('INVALID_SESSION_ID', 'The session id is not a safe single path segment.')
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined) return failure('UNAVAILABLE', 'Session persistence is not mounted.')

    let snapshot
    try {
      snapshot = await persistence.stat(sessionId)
    } catch (error) {
      return failure('INTERNAL', `Could not read the session: ${messageOf(error)}`)
    }
    if (snapshot === undefined) return failure('NOT_FOUND', 'The session does not exist.')

    const agent = loadedAgent(ctx, sessionId)
    const live = agent !== undefined
    let activity = []
    let activityFailure = null
    try {
      activity = await activityOf(ctx, sessionId)
    } catch (error) {
      activityFailure = messageOf(error)
    }

    let locationError = null
    let location = null
    if (snapshot.location !== undefined) {
      try {
        location = resolveSessionDirectory({ sessionId, location: snapshot.location })
      } catch (error) {
        if (error instanceof SessionLocationError) locationError = error
        else locationError = new SessionLocationError('UNEXPECTED_LAYOUT', messageOf(error))
      }
    }

    /** @type {Failure | null} */
    let blocked = null
    if (activityFailure !== null) {
      blocked = { code: 'ACTIVITY_CHECK_FAILED', message: activityFailure }
    } else if (activity.length > 0) {
      blocked = {
        code: 'ACTIVE',
        message: 'The session still has running work.',
        details: { activity },
      }
    } else if (snapshot.location === undefined) {
      blocked = { code: 'NOT_MATERIALIZED', message: 'The session has no materialized log yet.' }
    } else if (locationError !== null) {
      blocked = { code: locationError.code, message: locationError.message }
    }
    if (blocked === null && typeof persistence.open !== 'function') {
      blocked = { code: 'AGENT_RELEASE_UNAVAILABLE', message: 'The Host cannot acquire exclusive session ownership for deletion.' }
    }
    if (blocked === null && live) {
      try {
        idleAgentRelease(agent)
      } catch (error) {
        blocked = { code: 'AGENT_RELEASE_UNAVAILABLE', message: messageOf(error) }
      }
    }
    if (blocked === null && deleting.has(sessionId)) {
      blocked = { code: 'DELETE_IN_PROGRESS', message: 'This session is already being deleted.' }
    }

    const header = snapshot.header ?? {}
    const registry = ctx.get('workspaceRegistry')
    const archived = registry !== undefined
      && Array.isArray(registry.archivedSessionIds)
      && registry.archivedSessionIds.includes(sessionId)
    const pinned = registry !== undefined
      && Array.isArray(registry.pinnedSessionIds)
      && registry.pinnedSessionIds.includes(sessionId)
    return {
      ok: true,
      value: {
        sessionId,
        title: await readTitle(ctx, sessionId),
        cwd: typeof header.cwd === 'string' ? header.cwd : null,
        createdAt: typeof header.createdAt === 'number' ? header.createdAt : null,
        parentSessionId: typeof header.parentSession === 'string' ? header.parentSession : null,
        childSessionCount: await countDescendants(ctx, sessionId),
        eventCount: typeof snapshot.eventCount === 'number' ? snapshot.eventCount : null,
        sizeBytes: typeof snapshot.sizeBytes === 'number' ? snapshot.sizeBytes : null,
        formatStatus: typeof snapshot.formatStatus === 'string' ? snapshot.formatStatus : null,
        storageKind: typeof snapshot.location?.kind === 'string' ? snapshot.location.kind : null,
        live,
        activity,
        archived,
        pinned,
        canDelete: blocked === null,
        blocked,
      },
    }
  }

  /**
   * Permanently delete one Session. The log directory is removed first: if that
   * irreversible step fails, no workspace metadata has been touched. Derived
   * caches are removed before the log so they cannot outlive it after a crash.
   * Workspace metadata is cleaned afterwards and reported as warnings when it
   * fails, because the session data is already gone and the next restart
   * reconciles unknown ids.
   *
   * @param {string} sessionId target Session.
   * @param {{ confirm?: boolean }} [options] Host-side confirmation guard.
   * @returns {Promise<Result>} deletion receipt.
   */
  async function deleteSession(sessionId, options = {}) {
    if (!isSafeSessionId(sessionId)) return failure('INVALID_SESSION_ID', 'The session id is not a safe single path segment.')
    if (options === null || typeof options !== 'object' || options.confirm !== true) {
      return failure('CONFIRMATION_REQUIRED', 'Deletion requires an explicit confirmation.')
    }
    if (deleting.has(sessionId)) return failure('DELETE_IN_PROGRESS', 'This session is already being deleted.')
    deleting.add(sessionId)
    let lease
    let result
    try {
      result = await deleteOwnedSession(sessionId, (handle) => { lease = handle })
    } catch (error) {
      result = failure('INTERNAL', messageOf(error))
    } finally {
      try {
        await lease?.close()
      } catch (error) {
        if (result?.ok) result.value.warnings.push({ code: 'WRITE_LEASE_RELEASE_FAILED', message: messageOf(error) })
        else result = failure('DELETE_FAILED', `Could not release deletion ownership: ${messageOf(error)}`)
      }
      deleting.delete(sessionId)
    }
    return result
  }

  async function deleteOwnedSession(sessionId, retainLease) {
    const persistence = ctx.get('sessionPersistence')
    if (persistence === undefined) return failure('UNAVAILABLE', 'Session persistence is not mounted.')

    let snapshot
    try {
      snapshot = await persistence.stat(sessionId)
    } catch (error) {
      return failure('INTERNAL', `Could not read the session: ${messageOf(error)}`)
    }
    if (snapshot === undefined) return failure('NOT_FOUND', 'The session does not exist.')

    let activity
    try {
      activity = await activityOf(ctx, sessionId)
    } catch (error) {
      return failure('ACTIVITY_CHECK_FAILED', messageOf(error))
    }
    if (activity.length > 0) {
      return failure('ACTIVE', 'The session still has running work.', { activity })
    }
    if (snapshot.location === undefined) {
      return failure('NOT_MATERIALIZED', 'The session has no materialized log yet.')
    }

    try {
      resolveSessionDirectory({ sessionId, location: snapshot.location })
    } catch (error) {
      if (error instanceof SessionLocationError) return failure(error.code, error.message)
      return failure('UNEXPECTED_LAYOUT', messageOf(error))
    }

    const agent = loadedAgent(ctx, sessionId)
    let agentReleased = false
    if (agent !== undefined) {
      let release
      try {
        release = idleAgentRelease(agent)
      } catch (error) {
        return failure('AGENT_RELEASE_UNAVAILABLE', messageOf(error))
      }
      let releaseTask
      try {
        // Claim a genuinely idle driver synchronously. Start teardown here but
        // never await/return it from maintenance: teardown itself awaits idle.
        await agent.runMaintenance(() => {
          releaseTask = (async () => release())()
          releaseTask.catch(() => {})
        })
      } catch (error) {
        if (releaseTask === undefined) return failure('ACTIVE', 'The session started work before it could be released.', { activity: [{ kind: 'maintenance' }] })
        await releaseTask.catch(() => {})
        return failure('AGENT_RELEASE_FAILED', messageOf(error))
      }
      try {
        await releaseTask
      } catch (error) {
        return failure('AGENT_RELEASE_FAILED', messageOf(error))
      }
      if (loadedAgent(ctx, sessionId) !== undefined || ctx.get('sessions')?.get?.(sessionId) !== undefined) {
        return failure('AGENT_RELEASE_FAILED', 'The session is still loaded after release; its stored data was kept.')
      }
      agentReleased = true
    }

    // Take exclusive durable ownership after the old writer closes. A racing
    // resume or another process holding the writer causes refusal, not deletion.
    if (typeof persistence.open !== 'function') return failure('AGENT_RELEASE_UNAVAILABLE', 'The Host cannot acquire exclusive session ownership for deletion.')
    try {
      const lease = await persistence.open(sessionId, 'write')
      if (typeof lease?.close !== 'function') throw new Error('The Host returned an invalid session write handle.')
      retainLease(lease)
    } catch (error) {
      return failure('AGENT_RELEASE_FAILED', `Could not acquire exclusive ownership for deletion: ${messageOf(error)}`)
    }
    if (loadedAgent(ctx, sessionId) !== undefined || ctx.get('sessions')?.get?.(sessionId) !== undefined) {
      return failure('AGENT_RELEASE_FAILED', 'The session was reopened during deletion; its stored data was kept.')
    }
    try {
      const again = await activityOf(ctx, sessionId)
      if (again.length > 0) {
        return failure('ACTIVE', 'The session started working while confirming; stop it and try again.', { activity: again })
      }
    } catch (error) {
      return failure('ACTIVITY_CHECK_FAILED', messageOf(error))
    }

    // Closing buffered writers or opening a historical log can change its
    // physical generation. Resolve and validate its current path under the lease.
    try {
      snapshot = await persistence.stat(sessionId)
      if (snapshot === undefined) return failure('NOT_FOUND', 'The session no longer exists.')
      resolveSessionDirectory({ sessionId, location: snapshot.location })
    } catch (error) {
      if (error instanceof SessionLocationError) return failure(error.code, error.message)
      return failure('INTERNAL', messageOf(error))
    }

    const warnings = []
    const cache = await deleteProjectionCache(ctx, sessionId)
    if (cache.warning !== undefined) warnings.push(cache.warning)

    let removal
    try {
      removal = await deleteSessionDirectory({ sessionId, location: snapshot.location })
    } catch (error) {
      if (error instanceof SessionLocationError) return failure(error.code, error.message)
      return failure('DELETE_FAILED', `Could not delete the session log: ${messageOf(error)}`, {
        causeCode: error !== null && typeof error === 'object' && typeof error.code === 'string' ? error.code : null,
      })
    }
    if (!removal.verified) {
      warnings.push({ code: 'VERIFY_FAILED', message: 'The session log path still exists after the delete completed.' })
    }

    const clean = await cleanWorkspaceMetadata(ctx, sessionId)
    for (const warning of clean.warnings) warnings.push(warning)

    try {
      ctx.emit('api-session/removed', sessionId)
    } catch (error) {
      warnings.push({ code: 'EVENT_EMIT_FAILED', message: messageOf(error) })
    }

    return {
      ok: true,
      value: {
        sessionId,
        agentReleased,
        deleted: true,
        logDeleted: removal.deleted,
        alreadyGone: removal.alreadyGone,
        projectionCacheDeleted: cache.deleted,
        workspaceDetached: clean.detached,
        wasArchived: clean.archived,
        wasPinned: clean.pinned,
        warnings,
      },
    }
  }

  return { plan, deleteSession }
}

/**
 * Host names accepted for a page request. The bound origin is always accepted;
 * when it is a loopback bind, its common loopback spellings are accepted too so
 * opening the GUI as localhost/127.0.0.1 does not disable the feature.
 *
 * @param {URL} expectedOrigin bound Web origin.
 * @returns {Set<string>} accepted Host-header values.
 */
function allowedPageHosts(expectedOrigin) {
  const hosts = new Set([expectedOrigin.host])
  const hostname = expectedOrigin.hostname
  const loopback = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
  if (loopback) {
    const port = expectedOrigin.port
    for (const name of ['localhost', '127.0.0.1', '[::1]']) {
      hosts.add(port === '' ? name : `${name}:${port}`)
    }
  }
  return hosts
}

/**
 * Accept only the local page's own origin. This blocks cross-site form/fetch
 * attempts and DNS-rebinding requests whose Host is an attacker name; the
 * bearer token is the second layer. The Desktop shell strips Origin and Fetch
 * Metadata and injects its Host-issued cookie instead; only the Host connection
 * service can authenticate that cookie as the browser Peer.
 *
 * @param {import('node:http').IncomingMessage} req incoming request.
 * @param {URL | undefined} expectedOrigin bound Web origin.
 * @param {object | undefined} connection Host connection admission service.
 * @returns {boolean} whether the request is from the local Harness page.
 */
function isAllowedPageRequest(req, expectedOrigin, connection) {
  if (expectedOrigin === undefined) return false
  const hosts = allowedPageHosts(expectedOrigin)
  if (typeof req.headers.host !== 'string' || !hosts.has(req.headers.host)) return false
  const site = req.headers['sec-fetch-site']
  if (site !== undefined && site !== 'same-origin') return false
  const origin = req.headers.origin
  if (origin !== undefined) {
    try {
      if (typeof origin !== 'string') return false
      const pageOrigin = new URL(origin)
      if (pageOrigin.protocol !== expectedOrigin.protocol || pageOrigin.host !== req.headers.host) return false
      if (pageOrigin.origin !== origin) return false
    } catch {
      return false
    }
  } else if (site !== 'same-origin') {
    // Missing browser markers alone are never evidence of trust. Admit only
    // the authenticated browser Peer, not API/operator Peers or a cookie-shaped
    // header. Fail closed on older/unavailable/disposed connection services.
    if (typeof connection?.admit !== 'function' || connection.browserPeer == null) return false
    try {
      const admission = connection.admit(req)
      return admission?.peer === connection.browserPeer
    } catch {
      return false
    }
  }
  return true
}

/**
 * @param {import('node:http').IncomingMessage} req incoming request.
 * @param {number} limit maximum body bytes.
 * @returns {Promise<Record<string, unknown>>} parsed JSON body.
 */
async function readJsonBody(req, limit = MAX_BODY_BYTES) {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > limit) {
    const error = new Error('Request body is too large.')
    error.code = 'BODY_TOO_LARGE'
    throw error
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) {
      const error = new Error('Request body is too large.')
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

/**
 * @param {import('node:http').ServerResponse} res response.
 * @param {number} status HTTP status.
 * @param {unknown} payload JSON payload.
 */
function sendJson(res, status, payload) {
  if (res.headersSent || res.destroyed) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

/**
 * @param {string} code failure code.
 * @returns {number} HTTP status for a failed service call.
 */
function statusFor(code) {
  switch (code) {
    case 'NOT_FOUND':
      return 404
    case 'INVALID_SESSION_ID':
    case 'CONFIRMATION_REQUIRED':
    case 'INVALID_JSON':
    case 'BODY_TOO_LARGE':
      return 400
    case 'DELETE_FAILED':
    case 'INTERNAL':
      return 500
    default:
      return 409
  }
}

/**
 * Register the Host half.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx owning Host context.
 */
export function apply(ctx) {
  const webServer = ctx.webServer
  const service = createService(ctx)
  const token = randomBytes(32).toString('hex')

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      try {
        const expectedOrigin = (() => {
          try {
            return new URL(webServer.getOrigin())
          } catch {
            return undefined
          }
        })()

        if (!isAllowedPageRequest(req, expectedOrigin, ctx.get('connection'))) {
          sendJson(res, 403, failure('FORBIDDEN_ORIGIN', 'This endpoint is available only from the local Harness page.'))
          return
        }

        const url = new URL(req.url ?? '/', expectedOrigin)
        if (url.pathname === `${ROUTE_PREFIX}/token`) {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405, { allow: 'GET, HEAD' })
            res.end()
            return
          }
          if (req.method === 'HEAD') {
            res.writeHead(200, { 'cache-control': 'no-store' })
            res.end()
            return
          }
          sendJson(res, 200, { ok: true, token })
          return
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { allow: 'POST' })
          res.end()
          return
        }

        const provided = req.headers[TOKEN_HEADER]
        const expected = Buffer.from(token, 'utf8')
        const actual = Buffer.from(typeof provided === 'string' ? provided : '', 'utf8')
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
          sendJson(res, 403, failure('FORBIDDEN_TOKEN', 'The request token is missing or stale; refresh the page and try again.'))
          return
        }

        const contentType = String(req.headers['content-type'] ?? '')
        if (!contentType.toLowerCase().startsWith('application/json')) {
          sendJson(res, 415, failure('UNSUPPORTED_MEDIA_TYPE', 'Use application/json.'))
          return
        }

        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          const code = error !== null && typeof error === 'object' && error.code === 'BODY_TOO_LARGE'
            ? 'BODY_TOO_LARGE'
            : 'INVALID_JSON'
          sendJson(res, code === 'BODY_TOO_LARGE' ? 413 : 400, failure(code, messageOf(error)))
          return
        }

        const sessionId = readSessionId(body.sessionId)
        if (sessionId === undefined) {
          sendJson(res, 400, failure('INVALID_SESSION_ID', 'The session id is not a safe single path segment.'))
          return
        }

        let result
        if (url.pathname === `${ROUTE_PREFIX}/plan`) {
          result = await service.plan(sessionId)
        } else if (url.pathname === `${ROUTE_PREFIX}/delete`) {
          result = await service.deleteSession(sessionId, { confirm: body.confirm === true })
        } else {
          sendJson(res, 404, failure('NOT_FOUND', 'Unknown session-delete endpoint.'))
          return
        }

        if (result.ok) sendJson(res, 200, result)
        else sendJson(res, statusFor(result.error.code), result)
      } catch (error) {
        ctx.logger?.warn?.(`dsh-session-delete: request failed: ${messageOf(error)}`)
        sendJson(res, 500, failure('INTERNAL', messageOf(error)))
      }
    },
  }), 'dsh-session-delete: web route')

  ctx.effect(() => ctx.provide('sessionDeletion', service), 'dsh-session-delete: Host service')
}
