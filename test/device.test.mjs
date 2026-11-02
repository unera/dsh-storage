import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply, ROUTE_PREFIX, SETTINGS_NAMESPACE, oauthTransport, deviceStates } from '../index.mjs'

/** Boot the plugin with stub services and a stubbed OAuth transport. */
async function boot(providers) {
  const ctx = new Context()
  const record = { routes: [], document: { providers }, stored: new Map() }
  ctx.provide('tools', { register: () => {} })
  ctx.provide('systemPrompt', { section: () => () => {}, getSectionOrder: () => 100 })
  ctx.provide('settings', {
    configure: () => {},
    describe: () => [{ ns: SETTINGS_NAMESPACE, value: record.document }],
    update: async (ns, value) => { record.document = { ...record.document, ...value } },
  })
  ctx.provide('webServer', { register: route => { record.routes.push(route); return () => {} } })
  ctx.provide('credentials', {
    resolve: async ref => (record.stored.has(String(ref)) ? { value: record.stored.get(String(ref)), source: 'file' } : undefined),
    set: async (ref, value) => { record.stored.set(String(ref), value) },
    describe: async ref => ({ configured: record.stored.has(String(ref)) }),
  })
  apply(ctx, {})
  for (let attempt = 0; attempt < 50 && record.routes.length === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  return { ctx, record, handler: record.routes[0].handler }
}

function call(handler, { method = 'GET', url, body }) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  const request = {
    method,
    url,
    headers: { 'content-type': 'application/json', host: 'dsh.example' },
    async *[Symbol.asyncIterator]() { if (payload !== undefined) yield payload },
  }
  return new Promise((resolve, reject) => {
    let status = 0
    let text = ''
    const response = {
      writeHead: code => { status = code; return response },
      end: chunk => { text += chunk ?? ''; resolve({ status, body: text === '' ? undefined : JSON.parse(text) }) },
    }
    Promise.resolve(handler(request, response)).catch(reject)
  })
}

const ENTRY = { id: 'st-0009', type: 'yadisk', options: { clientId: 'app-1' } }

test('the device flow asks for a code, polls while pending, then stores the token', async () => {
  deviceStates.clear()
  const { ctx, handler, record } = await boot([ENTRY])
  const calls = []
  const original = oauthTransport.fetch
  oauthTransport.fetch = async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') })
    if (String(url).includes('/device/code')) {
      return new Response(JSON.stringify({ device_code: 'dev-1', user_code: 'h5nbcr6c', verification_url: 'https://oauth.yandex.com/device', interval: 5, expires_in: 300 }), { status: 200 })
    }
    return new Response(JSON.stringify({ access_token: 'tok-1', token_type: 'bearer' }), { status: 200 })
  }
  try {
    const started = await call(handler, { method: 'POST', url: '/__fs/providers/0/auth/device/start' })
    assert.equal(started.status, 200)
    assert.equal(started.body.userCode, 'h5nbcr6c')
    assert.equal(started.body.verificationUrl, 'https://oauth.yandex.com/device')
    assert.equal(typeof started.body.state, 'string')

    // The provider asked for five seconds between polls; an immediate poll must not
    // reach it, otherwise the provider starts answering with rate-limit errors.
    const tooSoon = await call(handler, { method: 'POST', url: '/__fs/providers/0/auth/device/poll', body: { state: started.body.state } })
    assert.equal(tooSoon.body.status, 'pending')
    assert.equal(calls.length, 1)

    // Pretend the interval passed.
    const recordState = deviceStates.get(started.body.state)
    recordState.lastPollAt = 0
    const confirmed = await call(handler, { method: 'POST', url: '/__fs/providers/0/auth/device/poll', body: { state: started.body.state } })
    assert.equal(confirmed.body.status, 'ok')
    assert.equal(record.stored.get('DSH_FILESTORE_ST_0009'), 'tok-1')
    assert.match(calls.at(-1).body, /grant_type=device_code/)
  } finally {
    oauthTransport.fetch = original
    await ctx.stop?.()
  }
})

test('an unknown state reports expired instead of calling the provider', async () => {
  deviceStates.clear()
  const { ctx, handler } = await boot([ENTRY])
  const original = oauthTransport.fetch
  let called = 0
  oauthTransport.fetch = async () => { called += 1; return new Response('{}', { status: 200 }) }
  try {
    const response = await call(handler, { method: 'POST', url: '/__fs/providers/0/auth/device/poll', body: { state: 'nope' } })
    assert.equal(response.body.status, 'expired')
    assert.equal(called, 0)
  } finally {
    oauthTransport.fetch = original
    await ctx.stop?.()
  }
})

test('without a client id the flow is refused before any network call', async () => {
  deviceStates.clear()
  const { ctx, handler } = await boot([{ id: 'st-0010', type: 'yadisk', options: {} }])
  const original = oauthTransport.fetch
  let called = 0
  oauthTransport.fetch = async () => { called += 1; return new Response('{}', { status: 200 }) }
  try {
    const response = await call(handler, { method: 'POST', url: '/__fs/providers/0/auth/device/start' })
    assert.equal(response.status, 400)
    assert.equal(response.body.code, 'FILESTORE_NO_CLIENT_ID')
    assert.equal(called, 0)
  } finally {
    oauthTransport.fetch = original
    await ctx.stop?.()
  }
})
