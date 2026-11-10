import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { deleteSessionDirectory, isSafeSessionId, resolveSessionDirectory, SessionLocationError } from '../session-files.js'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-session-delete-'))
  const project = join(root, '--Users-test-project--')
  const id = 'session-00000000-0000-4000-8000-000000000000'
  const dir = join(project, id)
  const file = join(dir, 'session.v4.jsonl.zstd')
  await mkdir(dir, { recursive: true })
  await writeFile(file, 'header\n')
  await writeFile(join(dir, 'session.lock'), '')
  return { root, id, dir, file, location: { kind: 'jsonl', path: file } }
}

test('session id grammar accepts generated ids and rejects traversal', () => {
  assert.equal(isSafeSessionId('session-00000000-0000-4000-8000-000000000000'), true)
  assert.equal(isSafeSessionId('..'), false)
  assert.equal(isSafeSessionId('../session-x'), false)
  assert.equal(isSafeSessionId('session-x/../../etc'), false)
  assert.equal(isSafeSessionId(''), false)
  assert.equal(isSafeSessionId(null), false)
})

test('deletes a validated session-owned directory and verifies absence', async () => {
  const fx = await fixture()
  try {
    const resolved = resolveSessionDirectory({ sessionId: fx.id, location: fx.location })
    assert.equal(resolved.dir, fx.dir)
    assert.equal(resolved.file, 'session.v4.jsonl.zstd')
    const result = await deleteSessionDirectory({ sessionId: fx.id, location: fx.location })
    assert.equal(result.deleted, true)
    assert.equal(result.alreadyGone, false)
    assert.equal(result.verified, true)
    await assert.rejects(import('node:fs/promises').then((fs) => fs.lstat(fx.dir)), { code: 'ENOENT' })
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('is idempotent when the session directory is already gone', async () => {
  const fx = await fixture()
  try {
    await rm(fx.dir, { recursive: true, force: true })
    const result = await deleteSessionDirectory({ sessionId: fx.id, location: fx.location })
    assert.equal(result.deleted, false)
    assert.equal(result.alreadyGone, true)
    assert.equal(result.verified, true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('refuses a directory whose leaf name is not the session id', async () => {
  const fx = await fixture()
  try {
    const wrong = join(fx.dir, 'session.v4.jsonl.zstd')
    await assert.rejects(
      async () => resolveSessionDirectory({ sessionId: 'session-11111111-1111-4111-8111-111111111111', location: { kind: 'jsonl', path: wrong } }),
      (error) => error instanceof SessionLocationError && error.code === 'UNEXPECTED_LAYOUT',
    )
    const stillThere = await import('node:fs/promises').then((fs) => fs.lstat(fx.dir))
    assert.equal(stillThere.isDirectory(), true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('refuses a symlinked session directory', async () => {
  const fx = await fixture()
  try {
    const linked = join(fx.root, fx.id)
    await symlink(fx.dir, linked, 'dir')
    await assert.rejects(
      async () => deleteSessionDirectory({ sessionId: fx.id, location: { kind: 'jsonl', path: join(linked, 'session.v4.jsonl.zstd') } }),
      (error) => error instanceof SessionLocationError && error.code === 'UNEXPECTED_LAYOUT',
    )
    const stillThere = await import('node:fs/promises').then((fs) => fs.lstat(fx.dir))
    assert.equal(stillThere.isDirectory(), true)
  } finally {
    await rm(fx.root, { recursive: true, force: true })
  }
})

test('refuses non-JSONL storage, relative paths, and unexpected file names', async () => {
  const id = 'session-00000000-0000-4000-8000-000000000000'
  assert.throws(() => resolveSessionDirectory({ sessionId: id, location: { kind: 'sqlite', path: '/tmp/x' } }),
    (error) => error instanceof SessionLocationError && error.code === 'UNSUPPORTED_STORAGE')
  assert.throws(() => resolveSessionDirectory({ sessionId: id, location: { kind: 'jsonl', path: 'relative/session.v4.jsonl.zstd' } }),
    (error) => error instanceof SessionLocationError && error.code === 'UNEXPECTED_LAYOUT')
  assert.throws(() => resolveSessionDirectory({ sessionId: id, location: { kind: 'jsonl', path: `/tmp/${id}/session.log` } }),
    (error) => error instanceof SessionLocationError && error.code === 'UNEXPECTED_LAYOUT')
})

test('refuses a filesystem root as the session directory', () => {
  const id = 'session-00000000-0000-4000-8000-000000000000'
  assert.throws(() => resolveSessionDirectory({ sessionId: id, location: { kind: 'jsonl', path: '/session.v4.jsonl.zstd' } }),
    (error) => error instanceof SessionLocationError && error.code === 'UNEXPECTED_LAYOUT')
})
