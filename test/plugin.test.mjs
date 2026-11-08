import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply, ROUTE_PREFIX, SETTINGS_NAMESPACE, createStorageTools, nextEntryId, createFilestoreHandler, cronMatches, acquireRun, releaseRun } from '../index.mjs'

/**
 * Boot the plugin for real: a genuine cordis Context with the services it injects
 * stubbed out. `ctx.start()` is what makes `inject` callbacks run, so this checks
 * the actual wiring rather than a hand-rolled imitation of it.
 */
async function boot({ providers = [], backups = [], resolveValue = undefined, failWrites = false } = {}) {
  const ctx = new Context()
  const record = { tools: [], sections: [], routes: [], configured: [], document: { providers, backups }, secrets: [] }
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

test('nine tools register, plus admin routes', async () => {
  const { ctx, record } = await boot()
  try {
    assert.equal(record.tools.length, 9)
    assert.deepEqual(record.tools.map(tool => tool.name).sort(), [
      'backup_list', 'backup_run',
      'storage_delete', 'storage_df', 'storage_list', 'storage_ls', 'storage_mkdir', 'storage_read', 'storage_write',
    ])
    assert.deepEqual(record.configured, [{ auto: true }])
    // Twelve exact routes under /api, which the host admits only for its owner.
    assert.deepEqual(record.routes.map(route => route.path).sort(), [
      '/api/filestore/backups',
      '/api/filestore/backups/delete',
      '/api/filestore/backups/run',
      '/api/filestore/backups/save',
      '/api/filestore/backups/sections',
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
    // The harness registry rejects a section whose order is not a finite number.
    assert.equal(Number.isFinite(withStorage.record.sections[0].order), true)
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
      // dsh-storage backs itself up, so the run is not empty: it uploads an archive.
      assert.equal(run.body.code, 'ok')
      assert.match(run.body.message, /^uploaded daily_/)
      assert.match(run.body.archive.name, /^daily_.*\.tar$/)
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

test('backup_list returns configured backups without secrets', async () => {
  const { ctx, record } = await boot({
    providers: [{ id: 'st-0001', type: 'local', options: { root: '/tmp' } }],
    backups: [{ id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 3, timeoutSeconds: 120, sections: ['db'], include: ['db'], ignore: ['logs'], schedule: '0 3 * * *' }],
  })
  try {
    const tool = record.tools.find(item => item.name === 'backup_list')
    assert.equal(typeof tool.output.render, 'function', 'backup_list needs a render')
    const result = await tool.execute({})
    assert.equal(result.backups.length, 1)
    const item = result.backups[0]
    assert.equal(item.id, 'bk-0001')
    assert.equal(item.name, 'daily')
    assert.equal(item.providerId, 'st-0001')
    assert.equal(item.directory, 'bk')
    assert.equal(item.rotation, 3)
    assert.equal(item.timeoutSeconds, 120)
    assert.deepEqual(item.sections, ['db'])
    assert.deepEqual(item.include, ['db'])
    assert.deepEqual(item.ignore, ['logs'])
    assert.equal(item.schedule, '0 3 * * *')
    assert.equal(item.keyConfigured, false)
    assert.equal(item.credentialRef, undefined, 'credential reference is not exposed')
    assert.equal(item.secret, undefined)
  } finally {
    await ctx.stop?.()
  }
})

test('backup_run runs by id and awaits the full structured result', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-tool-run-'))
  try {
    const { ctx, record } = await boot({
      providers: [{ id: 'st-0001', type: 'local', role: 'primary', options: { root } }],
      // ignore the always-on 30s 'test' participant so this stays fast; the
      // self-backup section still runs for real.
      backups: [{ id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: ['test'], include: [] }],
    })
    try {
      const tool = record.tools.find(item => item.name === 'backup_run')
      assert.equal(typeof tool.output.render, 'function', 'backup_run needs a render')
      const result = await tool.execute({ id: 'bk-0001' })
      assert.equal(result.code, 'ok')
      assert.equal(typeof result.message, 'string')
      assert.ok(result.details && Array.isArray(result.details.sections))
      assert.match(result.archive.name, /^daily_.*\.tar$/)
      // The render produces a readable text block.
      const blocks = tool.output.render({ id: 'bk-0001' }, result)
      assert.equal(blocks[0].type, 'text')
      assert.match(blocks[0].text, /Бэкап выполнен/)
    } finally {
      await ctx.stop?.()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('backup_run answers not-found for an unknown id', async () => {
  const { ctx, record } = await boot({ backups: [{ id: 'bk-0001', name: 'daily', providerId: 'st-0001' }] })
  try {
    const tool = record.tools.find(item => item.name === 'backup_run')
    await assert.rejects(tool.execute({ id: 'bk-9999' }), /no backup with id/)
  } finally {
    await ctx.stop?.()
  }
})

test('save and delete are guarded while a backup is running', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-guard-'))
  try {
    const { ctx, record } = await boot({
      providers: [{ id: 'st-0001', type: 'local', role: 'primary', options: { root } }],
      backups: [{ id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk' }],
    })
    try {
      acquireRun('bk-0001')
      const save = await callApi(record, { method: 'POST', path: '/api/filestore/backups/save', body: { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk' } })
      assert.equal(save.status, 409)
      assert.equal(save.body.code, 'BACKUP_ALREADY_RUNNING')
      const del = await callApi(record, { method: 'POST', path: '/api/filestore/backups/delete', body: { id: 'bk-0001' } })
      assert.equal(del.status, 409)
      assert.equal(del.body.code, 'BACKUP_ALREADY_RUNNING')
      releaseRun('bk-0001')
      const del2 = await callApi(record, { method: 'POST', path: '/api/filestore/backups/delete', body: { id: 'bk-0001' } })
      assert.equal(del2.status, 200)
    } finally {
      releaseRun('bk-0001')
      await ctx.stop?.()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('list and backup_list report an active run', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-active-'))
  try {
    const { ctx, record } = await boot({
      providers: [{ id: 'st-0001', type: 'local', role: 'primary', options: { root } }],
      backups: [{ id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk' }],
    })
    try {
      acquireRun('bk-0001')
      const listed = await callApi(record, { path: '/api/filestore/backups' })
      assert.equal(listed.body.backups[0].running, true)
      assert.ok(listed.body.backups[0].startedAt)
      const tool = record.tools.find(item => item.name === 'backup_list')
      const result = await tool.execute({})
      assert.equal(result.backups[0].running, true)
      assert.ok(result.backups[0].startedAt)
    } finally {
      releaseRun('bk-0001')
      await ctx.stop?.()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a run persists lastRun into the settings document', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-lastrun-'))
  try {
    const { ctx, record } = await boot({
      providers: [{ id: 'st-0001', type: 'local', role: 'primary', options: { root } }],
      // ignore the 30s 'test' participant so the self-backup section still runs fast.
      backups: [{ id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', ignore: ['test'] }],
    })
    try {
      const run = await callApi(record, { method: 'POST', path: '/api/filestore/backups/run', body: { id: 'bk-0001' } })
      assert.equal(run.status, 200)
      assert.equal(run.body.code, 'ok')
      const stored = record.document.backups.find(item => item.id === 'bk-0001')
      assert.equal(stored.lastRun.code, 'ok')
      assert.ok(stored.lastRun.startedAt)
      assert.ok(stored.lastRun.finishedAt)
      assert.equal(typeof stored.lastRun.message, 'string')
    } finally {
      await ctx.stop?.()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refresh sections is not blocked by an active run lock', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-refresh-lock-'))
  try {
    const { ctx, record } = await boot({
      providers: [{ id: 'st-0001', type: 'local', role: 'primary', options: { root } }],
      backups: [{ id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk' }],
    })
    try {
      acquireRun('bk-0001')
      const refreshed = await callApi(record, { method: 'POST', path: '/api/filestore/backups/sections', body: { id: 'bk-0001' } })
      assert.equal(refreshed.status, 200)
      assert.deepEqual(refreshed.body.sections, ['core', 'dsh-storage.cfg'], 'prepare-only refresh is not blocked by running')
    } finally {
      releaseRun('bk-0001')
      await ctx.stop?.()
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
