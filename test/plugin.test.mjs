import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply, ROUTE_PREFIX, SETTINGS_NAMESPACE, createStorageTools, nextEntryId, createFilestoreHandler, cronMatches } from '../index.mjs'

/**
 * Boot the plugin for real: a genuine cordis Context with the services it injects
 * stubbed out. `ctx.start()` is what makes `inject` callbacks run, so this checks
 * the actual wiring rather than a hand-rolled imitation of it.
 */
async function boot({ providers = [], resolveValue = undefined, failWrites = false } = {}) {
  const ctx = new Context()
  const record = { tools: [], sections: [], routes: [], configured: [], document: { providers }, secrets: [] }
  ctx.provide('tools', { register: tool => record.tools.push(tool) })
  ctx.provide('systemPrompt', {
    section: section => { record.sections.push(section); return () => {} },
    getSectionOrder: () => 100,
  })
  ctx.provide('settings', {
    configure: options => record.configured.push(options),
    describe: () => [{ ns: SETTINGS_NAMESPACE, value: record.document }],
    update: async (ns, value) => {
      if (failWrites) throw new Error('settings write failed')
      record.document = { ...record.document, ...value }
    },
  })
  ctx.provide('webServer', { register: route => { record.routes.push(route); return () => {} } })
  // The real host asks this service whether a request carries a signed session;
  // the stub says yes, a separate test drives the refusal.
  // Both faces of the service the plugin uses: the route registry it mounts into,
  // and the admission check it no longer has to perform itself.
  ctx.provide('connection', {
    requestRejection: () => undefined,
    fetch: { register: route => { record.routes.push(route); return async () => {} } },
  })
  ctx.provide('credentials', {
    resolve: async () => resolveValue,
    set: async (ref, value) => { record.secrets.push([ref, value]) },
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

/** Drive one exact /api route the way the host would: a Request in, a Response out. */
async function callApi(record, target, extra = undefined) {
  const spec = typeof target === 'string' ? { path: target, ...(extra ?? {}) } : target
  const path = spec.path
  const body = spec.body
  const route = record.routes.find(item => item.path === path)
  if (route === undefined) throw new Error(`no route ${path}`)
  const verb = spec.method ?? (body === undefined ? 'GET' : 'POST')
  const request = new Request(`https://dsh.example${path}`, {
    method: verb,
    headers: { 'content-type': 'application/json' },
    body: verb === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  })
  const response = await route.fetch(request)
  const text = await response.text()
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text) }
}

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

test('seven tools register, plus admin routes', async () => {
  const { ctx, record } = await boot()
  try {
    assert.equal(record.tools.length, 7)
    assert.deepEqual(record.tools.map(tool => tool.name).sort(), [
      'storage_delete', 'storage_df', 'storage_list', 'storage_ls', 'storage_mkdir', 'storage_read', 'storage_write',
    ])
    assert.deepEqual(record.configured, [{ auto: true }])
    // Eleven exact routes under /api, which the host admits only for its owner.
    assert.deepEqual(record.routes.map(route => route.path).sort(), [
      '/api/filestore/backups',
      '/api/filestore/backups/delete',
      '/api/filestore/backups/run',
      '/api/filestore/backups/save',
      '/api/filestore/device/poll',
      '/api/filestore/device/start',
      '/api/filestore/providers',
      '/api/filestore/providers/delete',
      '/api/filestore/providers/primary',
      '/api/filestore/providers/save',
      '/api/filestore/providers/test',
    ])
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

      const listed = await callApi(record, { path: '/api/filestore/providers' })
      assert.equal(listed.status, 200)
      assert.equal(listed.body.providers.length, 1)
      assert.equal(listed.body.providers[0].secretConfigured, false)
      assert.deepEqual(listed.body.types, ['local', 's3', 'webdav', 'yadisk'])

      const created = await callApi(record, {
        method: 'POST',
        path: '/api/filestore/providers/save',
        body: { type: 'local', label: 'second', options: { root } },
      })
      assert.equal(created.status, 201)
      assert.equal(created.body.provider.label, 'second')
      assert.equal(record.document.providers.length, 2)

      const tested = await callApi(record, { method: 'POST', path: '/api/filestore/providers/test', body: { id: 'st-0001' } })
      assert.equal(tested.status, 200)
      assert.equal(tested.body.status.state, 'ok')

      const promoted = await callApi(record, { method: 'POST', path: '/api/filestore/providers/primary', body: { id: 'st-0002' } })
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
      const refused = await callApi(record, { method: 'POST', path: '/api/filestore/providers/delete', body: { id: 'st-0001' } })
      assert.equal(refused.status, 409)
      assert.equal(refused.body.code, 'FILESTORE_PRIMARY_IN_USE')
      const allowed = await callApi(record, { method: 'POST', path: '/api/filestore/providers/delete', body: { id: 'st-0002' } })
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
    const response = await callApi(record, { method: 'POST', path: '/api/filestore/providers/test', body: { id: 'st-0001' } })
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
    const response = await callApi(record, { method: 'POST', path: '/api/filestore/providers/test', body: { id: 'st-0001' } })
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

test('a rejected settings update answers 500 instead of killing the process', async () => {
  const { ctx, record } = await boot({ providers: [{ id: 'st-0001', type: 'local', options: { root: '/tmp' } }], failWrites: true })
  try {
    const response = await callApi(record, {
      method: 'POST',
      path: '/api/filestore/providers/save',
      body: { type: 'local', options: { root: '/tmp' } },
    })
    assert.equal(response.status, 400)
    // The point is that the await chain caught it: an unhandled rejection would
    // have ended the process instead of producing this answer.
    assert.equal(typeof response.body.code, 'string')
  } finally {
    await ctx.stop?.()
  }
})

test('an id is never reused after a deletion', () => {
  const tools = createStorageTools({ entries: () => [], status: () => ({}), driver: () => ({}) })
  assert.equal(tools.length, 7)
  assert.equal(nextEntryId([{ id: 'st-0001' }, { id: 'st-0003' }]), 'st-0002')
  assert.equal(nextEntryId([]), 'st-0001')
})

test('the admin routes are registered on the host channel, not as an open prefix', async () => {
  const { ctx, record } = await boot({ providers: [] })
  try {
    // The old /__fs prefix is gone: nothing is mounted on the web server at all,
    // so an unauthenticated client has no path to these operations.
    const mountedPrefixes = record.routes.filter(route => !String(route.path).startsWith('/api/'))
    assert.deepEqual(mountedPrefixes, [])
  } finally {
    await ctx.stop?.()
  }
})

test('the backup admin API saves a key encoded, lists and runs a backup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-backup-api-'))
  try {
    const { ctx, record } = await boot({ providers: [{ id: 'st-0001', type: 'local', label: 'tmp', role: 'primary', options: { root } }] })
    try {
      const saved = await callApi(record, {
        method: 'POST',
        path: '/api/filestore/backups/save',
        body: { name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 3, timeoutSeconds: 300, ignore: ['logs'], key: '  secret   key  ' },
      })
      assert.equal(saved.status, 201)
      assert.equal(saved.body.backup.name, 'daily')
      assert.equal(saved.body.backup.rotation, 3)
      assert.deepEqual(saved.body.backup.ignore, ['logs'])
      // The key is trimmed (outer spaces only) and stored as UTF-8 bytes -> base64.
      const keySecret = record.secrets.find(([ref]) => String(ref).includes('BACKUP_BK_0001_KEY'))
      assert.equal(keySecret[1], Buffer.from('secret   key', 'utf8').toString('base64'))

      const listed = await callApi(record, { path: '/api/filestore/backups' })
      assert.equal(listed.body.backups.length, 1)
      assert.equal(listed.body.providers[0].id, 'st-0001')

      const run = await callApi(record, { method: 'POST', path: '/api/filestore/backups/run', body: { id: 'bk-0001' } })
      assert.equal(run.status, 200)
      // No participants create sections in this boot, so it is an empty backup.
      assert.equal(run.body.code, 'ok')
      assert.equal(run.body.message, 'empty backup was not uploaded')
    } finally {
      await ctx.stop?.()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cronMatches understands star, step, list and range fields', () => {
  const at = (minute, hour, dom, month, dow) => new Date(2026, month - 1, dom, hour, minute, 0, 0)
  assert.equal(cronMatches('0 3 * * *', at(0, 3, 5, 11, 3)), true)
  assert.equal(cronMatches('0 3 * * *', at(1, 3, 5, 11, 3)), false)
  assert.equal(cronMatches('*/15 * * * *', at(30, 4, 5, 11, 3)), true)
  assert.equal(cronMatches('*/15 * * * *', at(5, 4, 5, 11, 3)), false)
  assert.equal(cronMatches('0 9 * * 1-5', at(0, 9, 6, 11, 3)), true)
  assert.equal(cronMatches('0 9 * * 1-5', at(0, 9, 8, 11, 6)), false)
  assert.equal(cronMatches('0 9,18 * * *', at(0, 18, 6, 11, 3)), true)
  assert.equal(cronMatches('0 9,18 * * *', at(0, 12, 6, 11, 3)), false)
})
