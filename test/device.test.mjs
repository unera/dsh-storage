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
      return new Response(JSON.stringify({ device_code: 'dev-1', user_code: 'h5nbcr6c', verification_url: 'https://oauth.yandex.com/device', interval: 1, expires_in: 300 }), { status: 200 })
    }
    return new Response(JSON.stringify({ access_token: 'tok-1', token_type: 'bearer' }), { status: 200 })
  }
  try {
    const started = await call(handler, { method: 'POST', url: '/__fs/providers/0/auth/device/start' })
    assert.equal(started.status, 200)
    assert.equal(started.body.userCode, 'h5nbcr6c')
    assert.equal(started.body.verificationUrl, 'https://oauth.yandex.com/device')
    assert.equal(typeof started.body.state, 'string')

    // The host polls on its own; wait for it to land instead of asking on demand.
    let confirmed
    for (let attempt = 0; attempt < 40; attempt += 1) {
      confirmed = await call(handler, { method: 'POST', url: '/__fs/providers/0/auth/device/poll', body: { state: started.body.state } })
      if (confirmed.body.status !== 'pending') break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
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

test('the handshake works before the entry is saved, and the id survives the save', async () => {
  deviceStates.clear()
  const { ctx, handler, record } = await boot([])
  const original = oauthTransport.fetch
  oauthTransport.fetch = async (url) => (String(url).includes('/device/code')
    ? new Response(JSON.stringify({ device_code: 'dev-2', user_code: 'aaaa1111', verification_url: 'https://oauth.yandex.com/device', interval: 1, expires_in: 60 }), { status: 200 })
    : new Response(JSON.stringify({ access_token: 'tok-2' }), { status: 200 }))
  try {
    const started = await call(handler, {
      method: 'POST',
      url: '/__fs/auth/device/start',
      body: { id: 'st-abcd', clientId: 'app-2', type: 'yadisk' },
    })
    assert.equal(started.status, 200)
    assert.equal(started.body.userCode, 'aaaa1111')

    let confirmed
    for (let attempt = 0; attempt < 40; attempt += 1) {
      confirmed = await call(handler, { method: 'POST', url: '/__fs/auth/device/poll', body: { state: started.body.state } })
      if (confirmed.body.status !== 'pending') break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(confirmed.body.status, 'ok')
    // The token is already under the id the form will save with.
    assert.equal(record.stored.get('DSH_FILESTORE_ST_ABCD'), 'tok-2')

    const created = await call(handler, { method: 'POST', url: '/__fs/providers', body: { id: 'st-abcd', type: 'yadisk', label: 'yandex', options: { clientId: 'app-2' } } })
    assert.equal(created.status, 201)
    assert.equal(created.body.provider.id, 'st-abcd')
  } finally {
    oauthTransport.fetch = original
    await ctx.stop?.()
  }
})

test('the application secret is stored apart from the token and sent on exchange', async () => {
  deviceStates.clear()
  const { ctx, handler, record } = await boot([])
  const seen = []
  const original = oauthTransport.fetch
  oauthTransport.fetch = async (url, init) => {
    seen.push(String(init?.body ?? ''))
    return String(url).includes('/device/code')
      ? new Response(JSON.stringify({ device_code: 'dev-3', user_code: 'bbbb2222', verification_url: 'https://oauth.yandex.com/device', interval: 1, expires_in: 60 }), { status: 200 })
      : new Response(JSON.stringify({ access_token: 'tok-3' }), { status: 200 })
  }
  try {
    // The panel saves the secret with the entry, not with the handshake.
    await call(handler, { method: 'POST', url: '/__fs/providers', body: { id: 'st-efgh', type: 'yadisk', options: { clientId: 'app-3' }, clientSecret: 'sec-3' } })
    assert.equal(record.stored.get('DSH_FILESTORE_ST_EFGH_CLIENT'), 'sec-3')

    const started = await call(handler, { method: 'POST', url: '/__fs/auth/device/start', body: { id: 'st-efgh', clientId: 'app-3', type: 'yadisk' } })
    let confirmed
    for (let attempt = 0; attempt < 40; attempt += 1) {
      confirmed = await call(handler, { method: 'POST', url: '/__fs/auth/device/poll', body: { state: started.body.state } })
      if (confirmed.body.status !== 'pending') break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(confirmed.body.status, 'ok')
    assert.match(seen.at(-1), /client_secret=sec-3/)
    assert.equal(record.stored.get('DSH_FILESTORE_ST_EFGH'), 'tok-3')
  } finally {
    oauthTransport.fetch = original
    await ctx.stop?.()
  }
})

test('a handshake survives a host restart: the state carries the device code', async () => {
  deviceStates.clear()
  const { ctx, handler, record } = await boot([])
  const original = oauthTransport.fetch
  oauthTransport.fetch = async (url) => (String(url).includes('/device/code')
    ? new Response(JSON.stringify({ device_code: 'dev-5', user_code: 'cccc3333', verification_url: 'https://ya.ru/device', interval: 1, expires_in: 60 }), { status: 200 })
    : new Response(JSON.stringify({ access_token: 'tok-5' }), { status: 200 }))
  try {
    const started = await call(handler, { method: 'POST', url: '/__fs/auth/device/start', body: { id: 'st-ijkl', clientId: 'app-5', type: 'yadisk' } })
    // Simulate the restart: the in-memory record is gone, the browser keeps the state.
    deviceStates.clear()
    const answer = await call(handler, { method: 'POST', url: '/__fs/auth/device/poll', body: { state: started.body.state } })
    assert.equal(answer.body.status, 'ok')
    assert.equal(record.stored.get('DSH_FILESTORE_ST_IJKL'), 'tok-5')
  } finally {
    oauthTransport.fetch = original
    await ctx.stop?.()
  }
})

test('an unsaved entry still exchanges: the secret arrives with the handshake', async () => {
  deviceStates.clear()
  const { ctx, handler, record } = await boot([])
  const seen = []
  const original = oauthTransport.fetch
  oauthTransport.fetch = async (url, init) => {
    seen.push(String(init?.body ?? ''))
    return String(url).includes('/device/code')
      ? new Response(JSON.stringify({ device_code: 'dev-9', user_code: 'dddd4444', verification_url: 'https://ya.ru/device', interval: 1, expires_in: 60 }), { status: 200 })
      : new Response(JSON.stringify({ access_token: 'tok-9' }), { status: 200 })
  }
  try {
    // No provider entry is saved yet: the form only has the id it will save with.
    const started = await call(handler, {
      method: 'POST',
      url: '/__fs/auth/device/start',
      body: { id: 'st-new1', clientId: 'app-9', clientSecret: 'sec-9', type: 'yadisk' },
    })
    assert.equal(started.status, 200)
    assert.equal(record.stored.get('DSH_FILESTORE_ST_NEW1_CLIENT'), 'sec-9')

    let confirmed
    for (let attempt = 0; attempt < 40; attempt += 1) {
      confirmed = await call(handler, { method: 'POST', url: '/__fs/auth/device/poll', body: { state: started.body.state } })
      if (confirmed.body.status !== 'pending') break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.equal(confirmed.body.status, 'ok')
    assert.match(seen.at(-1), /client_secret=sec-9/)
    assert.equal(record.stored.get('DSH_FILESTORE_ST_NEW1'), 'tok-9')
  } finally {
    oauthTransport.fetch = original
    await ctx.stop?.()
  }
})
