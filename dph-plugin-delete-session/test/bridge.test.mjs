import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'

import { apply } from '../index.js'

const origin = 'http://127.0.0.1:3080'
const prefix = '/api/dsh-session-delete'
const sessionId = 'session-auth-regression'

function fixture({ admission = 'browser', connectionAvailable = true } = {}) {
  let handler
  let admissionCalls = 0
  let sessionReads = 0
  const browserPeer = {}
  const connection = {
    browserPeer,
    admit(req) {
      admissionCalls += 1
      if (admission === 'throw') throw new Error('Connection unavailable')
      if (req.headers.cookie !== 'signed-host-cookie=valid' || admission === 'reject') return { rejection: 401 }
      return { peer: admission === 'browser' ? browserPeer : {} }
    },
  }
  const ctx = {
    webServer: {
      getOrigin: () => origin,
      register(route) {
        handler = route.handler
        return () => {}
      },
    },
    get(name) {
      if (name === 'connection') return connectionAvailable ? connection : undefined
      if (name === 'sessionPersistence') return {
        async stat() {
          sessionReads += 1
          return { header: { id: sessionId }, eventCount: 1 }
        },
        async list() { return [] },
      }
      return undefined
    },
    effect(fn) { fn() },
    provide() { return () => {} },
    async waterfall() { return [] },
  }
  apply(ctx)
  return {
    connection,
    get admissionCalls() { return admissionCalls },
    get sessionReads() { return sessionReads },
    async request(path = '/token', { headers = {}, method = 'GET', body } = {}) {
      const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
      Object.assign(req, { url: prefix + path, method, headers: { host: '127.0.0.1:3080', ...headers } })
      let status
      let responseHeaders
      let responseBody
      const res = {
        writeHead(code, values) { status = code; responseHeaders = values },
        end(value) { responseBody = value },
      }
      await handler(req, res)
      return { status, headers: responseHeaders, body: responseBody === undefined ? undefined : JSON.parse(responseBody) }
    },
  }
}

const desktop = { cookie: 'signed-host-cookie=valid' }
const browser = { 'sec-fetch-site': 'same-origin', origin }

test('desktop proxy can obtain a token and inspect a session through the authenticated browser Peer', async () => {
  const fx = fixture()
  const tokenResponse = await fx.request('/token', { headers: desktop })
  assert.equal(tokenResponse.status, 200)
  assert.match(tokenResponse.body.token, /^[a-f0-9]{64}$/)
  assert.equal(tokenResponse.headers['cache-control'], 'no-store')
  const plan = await fx.request('/plan', {
    method: 'POST',
    headers: { ...desktop, 'content-type': 'application/json', 'x-dsh-session-delete-token': tokenResponse.body.token },
    body: { sessionId },
  })
  assert.equal(plan.status, 200)
  assert.equal(plan.body.value.sessionId, sessionId)
  assert.equal(fx.admissionCalls, 2)
  assert.equal(fx.sessionReads, 1)
})

test('desktop requests still require the plugin token and explicit delete confirmation', async () => {
  const fx = fixture()
  const token = (await fx.request('/token', { headers: desktop })).body.token
  for (const value of [undefined, 'stale-token']) {
    const response = await fx.request('/delete', {
      method: 'POST', headers: { ...desktop, 'content-type': 'application/json', 'x-dsh-session-delete-token': value },
      body: { sessionId, confirm: true },
    })
    assert.equal(response.status, 403)
    assert.equal(response.body.error.code, 'FORBIDDEN_TOKEN')
  }
  const response = await fx.request('/delete', {
    method: 'POST', headers: { ...desktop, 'content-type': 'application/json', 'x-dsh-session-delete-token': token },
    body: { sessionId },
  })
  assert.equal(response.body.error.code, 'CONFIRMATION_REQUIRED')
  assert.equal(fx.sessionReads, 0)
})

test('missing browser markers require verified browser credentials, never cookie presence alone', async (t) => {
  for (const [name, options, headers] of [
    ['no cookie', {}, {}],
    ['forged cookie', {}, { cookie: 'signed-host-cookie=forged' }],
    ['rejected cookie', { admission: 'reject' }, desktop],
    ['API Peer', { admission: 'api' }, desktop],
    ['missing service', { connectionAvailable: false }, desktop],
    ['admission exception', { admission: 'throw' }, desktop],
  ]) await t.test(name, async () => {
    const fx = fixture(options)
    const response = await fx.request('/token', { headers })
    assert.equal(response.status, 403)
    assert.equal(response.body.error.code, 'FORBIDDEN_ORIGIN')
    assert.equal(response.body.token, undefined)
    assert.equal(fx.sessionReads, 0)
  })
})

test('unsupported connection admission APIs fail closed', async () => {
  const fx = fixture()
  delete fx.connection.admit
  assert.equal((await fx.request('/token', { headers: desktop })).status, 403)
})

test('authenticated desktop cookies cannot override untrusted Host or explicit browser origin markers', async (t) => {
  for (const [name, headers] of [
    ['DNS rebinding Host', { host: 'attacker.example:3080' }],
    ['different port', { host: '127.0.0.1:3081' }],
    ['cross-site', { 'sec-fetch-site': 'cross-site' }],
    ['same-site', { 'sec-fetch-site': 'same-site' }],
    ['navigation', { 'sec-fetch-site': 'none' }],
    ['foreign origin', { origin: 'https://attacker.example' }],
    ['custom scheme origin', { origin: 'dsh-app://app' }],
    ['opaque origin', { origin: 'null' }],
    ['different scheme', { origin: 'https://127.0.0.1:3080' }],
    ['different port origin', { origin: 'http://127.0.0.1:3081' }],
    ['cross-alias origin', { origin: 'http://localhost:3080' }],
    ['URL instead of origin', { origin: origin + '/path' }],
  ]) await t.test(name, async () => {
    const fx = fixture()
    const response = await fx.request('/token', { headers: { ...desktop, ...headers } })
    assert.equal(response.status, 403)
    assert.equal(response.body.error.code, 'FORBIDDEN_ORIGIN')
    assert.equal(fx.admissionCalls, 0)
  })
})

test('same-origin HTTP pages retain support for loopback aliases and GET without Origin', async (t) => {
  for (const host of ['127.0.0.1:3080', 'localhost:3080', '[::1]:3080']) await t.test(host, async () => {
    const fx = fixture()
    const headers = { ...browser, host, origin: `http://${host}` }
    assert.equal((await fx.request('/token', { headers })).status, 200)
    delete headers.origin
    assert.equal((await fx.request('/token', { headers })).status, 200)
    assert.equal(fx.admissionCalls, 0)
  })
})
