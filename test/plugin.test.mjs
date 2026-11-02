import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply, ROUTE_PREFIX, SETTINGS_NAMESPACE, createStorageTools } from '../index.mjs'

/**
 * Boot the plugin for real: a genuine cordis Context with the services it injects
 * stubbed out. `ctx.start()` is what makes `inject` callbacks run, so this checks
 * the actual wiring rather than a hand-rolled imitation of it.
 */
async function boot({ providers = [], resolveValue = undefined } = {}) {
  const ctx = new Context()
  const record = { tools: [], sections: [], routes: [], configured: [], document: { providers } }
  ctx.provide('tools', { register: tool => record.tools.push(tool) })
  ctx.provide('systemPrompt', {
    section: section => { record.sections.push(section); return () => {} },
    getSectionOrder: () => 100,
  })
  ctx.provide('settings', {
    configure: options => record.configured.push(options),
    describe: () => [{ ns: SETTINGS_NAMESPACE, value: record.document }],
    update: async (ns, value) => { record.document = { ...record.document, ...value } },
  })
  ctx.provide('webServer', { register: route => { record.routes.push(route); return () => {} } })
  ctx.provide('credentials', {
    resolve: async () => resolveValue,
    set: async () => {},
    describe: async () => ({ configured: false }),
  })
  apply(ctx, {})
  // `inject` callbacks run on the fiber scheduler, not inside `apply`, so one
  // turn of the loop is not enough; wait until the route shows up.
  for (let attempt = 0; attempt < 50 && record.routes.length === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await new Promise(resolve => setTimeout(resolve, 10))
  return { ctx, record }
}

/** Minimal HTTP request/response pair for the admin handler. */
function call(handler, { method = 'GET', url, body }) {
  const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
  const request = {
    method,
    url,
    headers: { 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      if (payload !== undefined) yield payload
    },
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

test('seven tools register, plus one admin route', async () => {
  const { ctx, record } = await boot()
  try {
    assert.equal(record.tools.length, 7)
    assert.deepEqual(record.tools.map(tool => tool.name).sort(), [
      'storage_delete', 'storage_df', 'storage_list', 'storage_ls', 'storage_mkdir', 'storage_read', 'storage_write',
    ])
    assert.deepEqual(record.configured, [{ auto: true }])
    assert.equal(record.routes.length, 1)
    assert.equal(record.routes[0].path, ROUTE_PREFIX)
  } finally {
    await ctx.stop?.()
  }
})

test('the prompt section appears only once a storage is enabled', async () => {
  const bare = await boot()
  assert.equal(bare.record.sections.length, 0)
  await bare.ctx.stop?.()

  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-prompt-'))
  try {
    const withStorage = await boot({ providers: [{ id: 'st-0001', type: 'local', role: 'primary', options: { root } }] })
    assert.equal(withStorage.record.sections.length, 1)
    assert.equal(withStorage.record.sections[0].name, 'tool:filestore')
    await withStorage.ctx.stop?.()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the admin API lists, adds, checks and promotes a storage', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-api-'))
  try {
    const { ctx, record } = await boot({ providers: [{ id: 'st-0001', type: 'local', label: 'tmp', role: 'secondary', options: { root } }] })
    try {
      const handler = record.routes[0].handler

      const listed = await call(handler, { url: '/__fs/providers' })
      assert.equal(listed.status, 200)
      assert.equal(listed.body.providers.length, 1)
      assert.equal(listed.body.providers[0].secretConfigured, false)
      assert.deepEqual(listed.body.types, ['local', 's3', 'webdav', 'yadisk'])

      const created = await call(handler, {
        method: 'POST',
        url: '/__fs/providers',
        body: { type: 'local', label: 'second', options: { root } },
      })
      assert.equal(created.status, 201)
      assert.equal(created.body.provider.label, 'second')
      assert.equal(record.document.providers.length, 2)

      const tested = await call(handler, { method: 'POST', url: '/__fs/providers/0/test' })
      assert.equal(tested.status, 200)
      assert.equal(tested.body.status.state, 'ok')

      const promoted = await call(handler, { method: 'POST', url: '/__fs/providers/1/primary' })
      assert.equal(promoted.status, 200)
      assert.deepEqual(record.document.providers.map(entry => entry.role), ['secondary', 'primary'])
    } finally {
      await ctx.stop?.()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the primary storage cannot be deleted while another one could take over', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-api-'))
  try {
    const { ctx, record } = await boot({
      providers: [
        { id: 'st-0001', type: 'local', role: 'primary', options: { root } },
        { id: 'st-0002', type: 'local', role: 'secondary', options: { root } },
      ],
    })
    try {
      const handler = record.routes[0].handler
      const refused = await call(handler, { method: 'DELETE', url: '/__fs/providers/0' })
      assert.equal(refused.status, 409)
      assert.equal(refused.body.code, 'FILESTORE_PRIMARY_IN_USE')
      const allowed = await call(handler, { method: 'DELETE', url: '/__fs/providers/1' })
      assert.equal(allowed.status, 200)
      assert.equal(record.document.providers.length, 1)
    } finally {
      await ctx.stop?.()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a storage without credentials reports unauthorized instead of throwing', async () => {
  const { ctx, record } = await boot({ providers: [{ id: 'st-0001', type: 's3', options: { bucket: 'b' } }] })
  try {
    const response = await call(record.routes[0].handler, { method: 'POST', url: '/__fs/providers/0/test' })
    assert.equal(response.status, 200)
    assert.equal(response.body.status.state, 'unauthorized')
    assert.match(response.body.status.message, /credential/i)
  } finally {
    await ctx.stop?.()
  }
})

test('every tool declares a name, a description and an output schema', () => {
  const tools = createStorageTools({
    entries: () => [],
    status: () => ({ state: 'unknown' }),
    driver: () => { throw new Error('not needed') },
  })
  for (const tool of tools) {
    assert.equal(typeof tool.name, 'string')
    assert.equal(typeof tool.description, 'string')
    assert.notEqual(tool.output, undefined, tool.name)
  }
})

test('every tool has a render, or the call fails before the model sees data', () => {
  const tools = createStorageTools({ entries: () => [], status: () => ({}), driver: () => ({}) })
  for (const tool of tools) {
    assert.equal(typeof tool.output?.render, 'function', `${tool.name} needs output.render`)
  }
})

test('renderers produce one text block and never throw on an empty result', () => {
  const tools = createStorageTools({ entries: () => [], status: () => ({}), driver: () => ({}) })
  const byName = new Map(tools.map(tool => [tool.name, tool]))
  const list = byName.get('storage_list').output.render({}, { storages: [] })
  assert.equal(list[0].type, 'text')
  assert.match(list[0].text, /Хранилищ нет/)
  const df = byName.get('storage_df').output.render({}, { storage: 'st-0001' })
  assert.equal(df[0].type, 'text')
  assert.match(df[0].text, /неизвестно/)
})

test('a resolved credential object reaches the driver as its value', async () => {
  // `credentials.resolve()` answers `{ value, source }`; handing that object to a
  // driver makes it report "no credentials" even though the secret is stored.
  const { ctx, record } = await boot({
    providers: [{ id: 'st-0001', type: 's3', options: { bucket: 'b', endpoint: 'http://127.0.0.1:1' } }],
    resolveValue: { value: JSON.stringify({ accessKeyId: 'a', secretAccessKey: 'b' }), source: 'file' },
  })
  try {
    const response = await call(record.routes[0].handler, { method: 'POST', url: '/__fs/providers/0/test' })
    // The endpoint is unreachable, so anything except "credential missing" means
    // the secret really arrived.
    assert.doesNotMatch(response.body.status.message, /no credentials/i)
  } finally {
    await ctx.stop?.()
  }
})

test('storage_read puts the file content into the render', () => {
  const tools = createStorageTools({ entries: () => [], status: () => ({}), driver: () => ({}) })
  const read = tools.find(tool => tool.name === 'storage_read')
  const blocks = read.output.render({ key: 'a.txt' }, { storage: 'st-0001', key: 'a.txt', content: 'тело файла', size: 20 })
  assert.equal(blocks.length, 1)
  assert.match(blocks[0].text, /тело файла/, 'the model only sees the render, so the content must be in it')
})
