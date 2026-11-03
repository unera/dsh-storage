import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createGoogleDriver, parseGoogleCredentials, errorForGoogle, escapeQuery, FOLDER_MIME } from '../gdrive.mjs'
import { normalizeEntry, readAll, KEEP_FILE } from '../index.mjs'

/**
 * A fake Drive v3: id-addressed files, name-in-parent search, multipart upload,
 * alt=media download and the storage quota. Paths do not exist here — that is the
 * whole point, the driver has to walk them.
 */
async function startFakeDrive() {
  let nextId = 1
  const files = new Map() // id -> { id, name, mimeType, body?, parents, modifiedTime }
  const root = { id: 'root', name: 'root', mimeType: FOLDER_MIME, parents: [] }
  files.set('root', root)
  const calls = []

  const children = parentId => [...files.values()].filter(file => file.parents?.includes(parentId))

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    calls.push(`${request.method} ${url.pathname}`)

    if (request.headers.authorization !== 'Bearer good-token') {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'bad token' } }))
      return
    }

    // Upload endpoints live under /upload/drive/v3.
    if (url.pathname.startsWith('/upload/drive/v3/files')) {
      const text = body.toString('utf8')
      const jsonStart = text.indexOf('{')
      const jsonEnd = text.indexOf('}\r\n') === -1 ? text.lastIndexOf('}') : text.indexOf('}\r\n')
      const metadata = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
      const marker = 'Content-Type: application/octet-stream\r\n\r\n'
      const contentStart = text.indexOf(marker) + marker.length
      const contentEnd = text.lastIndexOf('\r\n--')
      const content = Buffer.from(text.slice(contentStart, contentEnd), 'utf8')
      const target = url.pathname.match(/files\/([^/?]+)/)
      if (target !== null) {
        const existing = files.get(decodeURIComponent(target[1]))
        existing.body = content
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: existing.id }))
        return
      }
      const parentId = metadata.parents?.[0] ?? 'root'
      const id = `id-${nextId++}`
      files.set(id, { id, name: metadata.name, mimeType: 'application/octet-stream', body: content, parents: [parentId], modifiedTime: '2026-11-03T00:00:00Z' })
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id }))
      return
    }

    if (url.pathname === '/drive/v3/about') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ storageQuota: { limit: '1000', usage: '400' } }))
      return
    }

    if (url.pathname === '/drive/v3/files' && request.method === 'GET') {
      const q = url.searchParams.get('q') ?? ''
      const parentMatch = /'([^']+)' in parents/.exec(q)
      const nameMatch = /name = '((?:\\.|[^'])*)'/.exec(q)
      const parentId = parentMatch?.[1] ?? 'root'
      let list = children(parentId)
      if (nameMatch !== null) {
        const wanted = nameMatch[1].replace(/\\'/g, "'")
        list = list.filter(file => file.name === wanted)
      }
      const filesView = list.map(file => ({ id: file.id, name: file.name, mimeType: file.mimeType, size: String(file.body?.length ?? 0), modifiedTime: file.modifiedTime }))
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ files: filesView }))
      return
    }

    if (url.pathname === '/drive/v3/files' && request.method === 'POST') {
      const metadata = JSON.parse(body.toString('utf8'))
      const id = `id-${nextId++}`
      files.set(id, { id, name: metadata.name, mimeType: metadata.mimeType ?? 'application/octet-stream', parents: metadata.parents ?? ['root'], modifiedTime: '2026-11-03T00:00:00Z' })
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id }))
      return
    }

    const byId = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/)
    if (byId !== null) {
      const file = files.get(decodeURIComponent(byId[1]))
      if (file === undefined) {
        response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'not found' } }))
        return
      }
      if (request.method === 'DELETE') {
        files.delete(file.id)
        response.writeHead(204).end()
        return
      }
      if (url.searchParams.get('alt') === 'media') {
        response.writeHead(200, { 'content-length': String(file.body?.length ?? 0) }).end(file.body ?? Buffer.alloc(0))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: String(file.body?.length ?? 0),
        modifiedTime: file.modifiedTime,
      }))
      return
    }

    response.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'unexpected request' } }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    api: `http://127.0.0.1:${port}/drive/v3`,
    uploadApi: `http://127.0.0.1:${port}/upload/drive/v3`,
    files,
    calls,
    async close() {
      server.closeAllConnections?.()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

function driverFor(fake, options = {}) {
  const entry = normalizeEntry({ id: 'st-g1', type: 'gdrive', options: { api: fake.api, uploadApi: fake.uploadApi, ...options } }, 0)
  return createGoogleDriver(entry, { resolveSecret: async () => 'good-token' })
}

test('credentials accept a bare token or JSON', () => {
  assert.equal(parseGoogleCredentials('abc'), 'abc')
  assert.equal(parseGoogleCredentials('{"accessToken": "xyz"}'), 'xyz')
  assert.throws(() => parseGoogleCredentials(''), /no access token/)
})

test('errors map onto storage codes, quota separately', () => {
  assert.equal(errorForGoogle(401, {}).code, 'FILESTORE_UNAUTHORIZED')
  assert.equal(errorForGoogle(403, { error: { message: 'storage quota exceeded' } }).code, 'FILESTORE_QUOTA')
  assert.equal(errorForGoogle(404, {}).code, 'FILESTORE_NOT_FOUND')
  assert.equal(escapeQuery("a'b"), "a\\'b")
})

test('a write into a nested path creates the parents and reads back', async () => {
  const fake = await startFakeDrive()
  try {
    const driver = driverFor(fake)
    await driver.put('docs/notes/a.txt', 'привет')
    const text = (await readAll(await driver.get('docs/notes/a.txt'))).toString('utf8')
    assert.equal(text, 'привет')
    const listed = await driver.list('docs/notes')
    assert.deepEqual(listed.items.map(item => item.key), ['docs/notes/a.txt'])
  } finally {
    await fake.close()
  }
})

test('the folder walk is cached instead of repeated', async () => {
  const fake = await startFakeDrive()
  try {
    const driver = driverFor(fake)
    await driver.put('deep/one/two/a.txt', 'x')
    const before = fake.calls.length
    await driver.put('deep/one/two/b.txt', 'y')
    const spent = fake.calls.length - before
    // Creating b.txt should cost: one child lookup, one upload. Not a full re-walk.
    assert.ok(spent <= 3, `expected a cached walk, got ${spent} calls`)
  } finally {
    await fake.close()
  }
})

test('list hides the keep marker and reports directories', async () => {
  const fake = await startFakeDrive()
  try {
    const driver = driverFor(fake)
    await driver.mkdir('empty')
    const { items } = await driver.list('')
    assert.equal(items.some(item => item.key === 'empty' && item.type === 'directory'), true)
    assert.equal(items.some(item => item.key.includes(KEEP_FILE)), false)
  } finally {
    await fake.close()
  }
})

test('stat answers nothing for a missing key', async () => {
  const fake = await startFakeDrive()
  try {
    const driver = driverFor(fake)
    assert.equal(await driver.stat('nope.txt'), undefined)
    await driver.put('there.txt', 'abc')
    const info = await driver.stat('there.txt')
    assert.equal(info.size, 3)
  } finally {
    await fake.close()
  }
})

test('delete refuses a directory without recursive', async () => {
  const fake = await startFakeDrive()
  try {
    const driver = driverFor(fake)
    await driver.put('dir/a.txt', 'a')
    await assert.rejects(driver.delete('dir'), /pass recursive/)
    assert.deepEqual(await driver.delete('dir', { recursive: true }), { deleted: true, key: 'dir' })
  } finally {
    await fake.close()
  }
})

test('free space comes from the quota', async () => {
  const fake = await startFakeDrive()
  try {
    const driver = driverFor(fake)
    assert.deepEqual(await driver.free(), { freeBytes: 600, totalBytes: 1000 })
  } finally {
    await fake.close()
  }
})

test('the probe test passes end to end', async () => {
  const fake = await startFakeDrive()
  try {
    const driver = driverFor(fake)
    const result = await driver.test()
    assert.equal(result.state, 'ok')
    assert.equal([...fake.files.values()].some(file => file.name?.includes('probe')), false)
  } finally {
    await fake.close()
  }
})
