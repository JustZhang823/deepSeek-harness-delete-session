/**
 * Path-safe deletion of one JSONL session directory.
 *
 * The shipped session-persistence backend has no deletion API (its README says
 * logs accumulate until removed externally). This module owns the narrow,
 * defensive filesystem step: it accepts only a session-owned directory whose
 * leaf name is the session id and whose selected log file uses the documented
 * JSONL generation naming, then removes that directory with Node's cross-
 * platform `fs.rm` retry loop. It never shells out and never guesses a path.
 */

import { lstat, rm } from 'node:fs/promises'
import { basename, dirname, isAbsolute, parse } from 'node:path'

/** Conservative session-id grammar; session ids are generated as `session-<uuid>`. */
export const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/

/** Documented JSONL generations: session.jsonl, session.vN.jsonl, each optional .zstd. */
const LOG_FILE_PATTERN = /^session(?:\.v\d+)?\.jsonl(?:\.zstd)?$/

/** A location the deletion path refuses because deleting it would be unsafe. */
export class SessionLocationError extends Error {
  /**
   * @param {string} code stable failure code.
   * @param {string} message operator-facing diagnostic.
   * @param {Record<string, unknown>} [details] structured context.
   */
  constructor(code, message, details = undefined) {
    super(message)
    this.name = 'SessionLocationError'
    this.code = code
    this.details = details
  }
}

/**
 * @param {unknown} value candidate session id.
 * @returns {boolean} whether the value is a safe single-segment session id.
 */
export function isSafeSessionId(value) {
  return typeof value === 'string'
    && SESSION_ID_PATTERN.test(value)
    && value !== '.'
    && value !== '..'
}

/**
 * @param {string} left one path segment.
 * @param {string} right another path segment.
 * @returns {boolean} whether both spellings name the same segment on this platform.
 */
function sameSegment(left, right) {
  if (left === right) return true
  return process.platform === 'win32' && left.toLowerCase() === right.toLowerCase()
}

/**
 * Derive and validate the session-owned directory from a persistence snapshot
 * location. The caller must only pass a location obtained from
 * `ctx.sessionPersistence.stat()` for the same session id.
 *
 * @param {{ sessionId: string, location: { kind?: string, path?: string } }} input
 * @returns {{ dir: string, file: string }} validated absolute directory and log file name.
 * @throws {SessionLocationError} when the location is malformed or unsupported.
 */
export function resolveSessionDirectory({ sessionId, location }) {
  if (!isSafeSessionId(sessionId)) {
    throw new SessionLocationError('INVALID_SESSION_ID', `Refusing to delete an unsafe session id: ${JSON.stringify(sessionId)}`)
  }
  if (location === null || typeof location !== 'object') {
    throw new SessionLocationError('UNSUPPORTED_STORAGE', `Session '${sessionId}' has no stored location`)
  }
  if (location.kind !== 'jsonl') {
    throw new SessionLocationError(
      'UNSUPPORTED_STORAGE',
      `Session '${sessionId}' uses storage kind '${String(location.kind)}'; this plugin supports the shipped JSONL layout only`,
    )
  }
  const logPath = location.path
  if (typeof logPath !== 'string' || !isAbsolute(logPath)) {
    throw new SessionLocationError('UNEXPECTED_LAYOUT', `Session '${sessionId}' has a non-absolute log path`)
  }
  const file = basename(logPath)
  if (!LOG_FILE_PATTERN.test(file)) {
    throw new SessionLocationError('UNEXPECTED_LAYOUT', `Session '${sessionId}' has an unrecognized log file name: ${file}`)
  }
  const dir = dirname(logPath)
  if (dir === '' || dir === parse(dir).root) {
    throw new SessionLocationError('UNEXPECTED_LAYOUT', `Session '${sessionId}' resolves to a filesystem root`)
  }
  if (!sameSegment(basename(dir), sessionId)) {
    throw new SessionLocationError(
      'UNEXPECTED_LAYOUT',
      `Session '${sessionId}' is not stored in a directory named after its id (found '${basename(dir)}')`,
    )
  }
  if (dirname(dir) === dir) {
    throw new SessionLocationError('UNEXPECTED_LAYOUT', `Session '${sessionId}' has no parent directory`)
  }
  return { dir, file }
}

/**
 * Delete the session-owned directory. A directory that is already absent is an
 * idempotent success with `alreadyGone: true`.
 *
 * @param {{ sessionId: string, location: { kind?: string, path?: string } }} input
 * @returns {Promise<{ dir: string, deleted: boolean, alreadyGone: boolean, verified: boolean }>}
 * @throws {SessionLocationError|NodeJS.ErrnoException} on unsafe layout or filesystem failure.
 */
export async function deleteSessionDirectory({ sessionId, location }) {
  const { dir } = resolveSessionDirectory({ sessionId, location })

  let info
  try {
    info = await lstat(dir)
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return { dir, deleted: false, alreadyGone: true, verified: true }
    }
    throw error
  }

  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new SessionLocationError('UNEXPECTED_LAYOUT', `Refusing to remove a non-directory session path: ${dir}`)
  }

  await rm(dir, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  })

  let verified = true
  try {
    await lstat(dir)
    verified = false
  } catch (error) {
    if (error === null || typeof error !== 'object' || error.code !== 'ENOENT') throw error
  }

  return { dir, deleted: true, alreadyGone: false, verified }
}
