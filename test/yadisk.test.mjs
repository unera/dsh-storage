import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createYandexDriver, parseYandexCredentials, errorForYandex } from '../yadisk.mjs'
import { normalizeEntry, readAll, KEEP_FILE } from '../index.mjs'

/**
 * A fake Yandex Disk: resources API plus the upload/download hand-off. The
 * hand-off is the part worth testing — the API never carries bytes itself.
 */
async function startFakeDisk() {
  const files = new Map()          // 'folder/a.txt' -> Buffer
  const dirs = new Set([''])
  const uploads = new Map()
  const token = 'test-token'
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)

    // The hand-off URLs carry no authorization at all.
    if (url.pathname.startsWith('/upload/')) {
      // The upload link is where the bytes actually land; the API only handed it out.
      const key = decodeURIComponent(url.pathname.slice('/upload/'.length))
      files.set(key, body)
      uploads.set(url.pathname, body)
      response.writeHead(201).end()
      return
    }
    if (url.pathname.startsWith('/download/')) {
      const key = decodeURIComponent(url.pathname.slice('/download/'.length))
      if (!files.has(key)) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200).end(files.get(key))
      return
    }
    if (request.headers.authorization !== `OAuth ${token}`) {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ description: 'bad token' }))
      return
    }
    const path = (url.searchParams.get('path') ?? 'disk:/').replace(/^disk:\/?/, '').replace(/\/+$/, '')

    if (url.pathname === '/v1/disk/' || url.pathname === '/v1/disk') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ total_space: 10_000, used_space: 4_000 }))
      return
    }
    if (url.pathname === '/v1/disk/resources' && request.method === 'GET') {
      if (url.searchParams.has('fields')) {
        if (dirs.has(path)) {
          response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'x', type: 'dir' }))
          return
        }
        if (!files.has(path)) {
          response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ description: 'not found' }))
          return
        }
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: 'x', type: 'file', size: files.get(path).length }))
        return
      }
      const prefix = path === '' ? '' : `${path}/`
      const names = new Set()
      for (const name of [...files.keys(), ...dirs]) {
        if (name === '' || !name.startsWith(prefix)) continue
        names.add(name.slice(prefix.length).split('/')[0])
      }
      const items = [...names].filter(Boolean).map(name => {
        const key = `${prefix}${name}`
        return dirs.has(key)
          ? { name, type: 'dir' }
          : { name, type: 'file', size: files.get(key).length, modified: '2026-11-02T18:53:04Z' }
      })
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ _embedded: { items, total: items.length } }))
      return
    }
    if (url.pathname === '/v1/disk/resources' && request.method === 'PUT') {
      if (dirs.has(path)) {
        response.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ description: 'exists' }))
        return
      }
      dirs.add(path)
      response.writeHead(201).end()
      return
    }
    if (url.pathname === '/v1/disk/resources' && request.method === 'DELETE') {
      if (!files.has(path) && !dirs.has(path)) {
        response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ description: 'not found' }))
        return
      }
      files.delete(path)
      dirs.delete(path)
      response.writeHead(204).end()
      return
    }
    if (url.pathname === '/v1/disk/resources/upload') {
      // A folder must exist before anything can be uploaded into it.
      const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
      if (parent !== '' && !dirs.has(parent)) {
        response.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ description: 'Specified path does not exist' }))
        return
      }
      // Yandex answers the link request to a GET; anything else is a 403, and a
      // driver that asks with PUT looks like a permissions problem.
      if (request.method !== 'GET') {
        response.writeHead(403, { 'content-type': 'application/json' }).end(JSON.stringify({ description: 'Forbidden' }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ href: `http://127.0.0.1:${port}/upload/${encodeURIComponent(path)}` }))
      return
    }
    if (url.pathname === '/v1/disk/resources/download') {
      if (!files.has(path)) {
        response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ description: 'not found' }))
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ href: `http://127.0.0.1:${port}/download/${encodeURIComponent(path)}` }))
      return
    }
    response.writeHead(400).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    api: `http://127.0.0.1:${port}/v1/disk`,
    files,
    dirs,
    uploads,
    put(fileKey, text) { files.set(fileKey, Buffer.from(text)) },
    async close() {
      server.closeAllConnections?.()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

function driverFor(api) {
  const entry = normalizeEntry({ id: 'st-0001', type: 'yadisk', options: { api } }, 0)
  return createYandexDriver(entry, { resolveSecret: async () => 'test-token' })
}

test('credentials accept a bare token or JSON', () => {
  assert.equal(parseYandexCredentials('abc'), 'abc')
  assert.equal(parseYandexCredentials('{"token": "xyz"}'), 'xyz')
  assert.throws(() => parseYandexCredentials(''), /no token/)
  assert.throws(() => parseYandexCredentials('{"access_token": 5}'), /need a token/)
})

test('API errors map onto storage codes', () => {
  assert.equal(errorForYandex({ status: 401 }, { description: 'bad' }).code, 'FILESTORE_UNAUTHORIZED')
  assert.equal(errorForYandex({ status: 404 }, {}).code, 'FILESTORE_NOT_FOUND')
  assert.equal(errorForYandex({ status: 409 }, {}).code, 'FILESTORE_CONFLICT')
  assert.equal(errorForYandex({ status: 500 }, {}).code, 'FILESTORE_ERROR')
})

test('a write goes through the upload link, then back as a file', async () => {
  const fake = await startFakeDisk()
  try {
    const driver = driverFor(fake.api)
    await driver.mkdir('docs')
    await driver.put('docs/a.txt', 'привет')
    assert.equal(fake.files.get('docs/a.txt').toString('utf8'), 'привет')
    const text = (await readAll(await driver.get('docs/a.txt'))).toString('utf8')
    assert.equal(text, 'привет')
  } finally {
    await fake.close()
  }
})

test('listing reports files and directories, hiding the keep marker', async () => {
  const fake = await startFakeDisk()
  try {
    fake.dirs.add('docs')
    fake.put('docs/a.txt', 'a')
    fake.put(`docs/${KEEP_FILE}`, '')
    const driver = driverFor(fake.api)
    const { items } = await driver.list('docs')
    assert.deepEqual(items.map(item => item.key), ['docs/a.txt'])
  } finally {
    await fake.close()
  }
})

test('stat answers nothing for a missing key', async () => {
  const fake = await startFakeDisk()
  try {
    const driver = driverFor(fake.api)
    assert.equal(await driver.stat('nope.txt'), undefined)
    fake.put('there.txt', 'abc')
    assert.equal((await driver.stat('there.txt')).size, 3)
  } finally {
    await fake.close()
  }
})

test('delete is idempotent for a missing key', async () => {
  const fake = await startFakeDisk()
  try {
    const driver = driverFor(fake.api)
    fake.put('gone.txt', 'x')
    assert.deepEqual(await driver.delete('gone.txt'), { deleted: true, key: 'gone.txt' })
    assert.deepEqual(await driver.delete('gone.txt'), { deleted: false, key: 'gone.txt' })
  } finally {
    await fake.close()
  }
})

test('free space comes from total and used', async () => {
  const fake = await startFakeDisk()
  try {
    const driver = driverFor(fake.api)
    assert.deepEqual(await driver.free(), { freeBytes: 6000, totalBytes: 10000 })
  } finally {
    await fake.close()
  }
})

test('mkdir survives an existing directory (409) and leaves the marker', async () => {
  const fake = await startFakeDisk()
  try {
    fake.dirs.add('exists')
    const driver = driverFor(fake.api)
    const result = await driver.mkdir('exists')
    assert.equal(result.created, true)
    assert.equal(fake.files.has(`exists/${KEEP_FILE}`), true)
  } finally {
    await fake.close()
  }
})

test('the probe test passes end to end', async () => {
  const fake = await startFakeDisk()
  try {
    const driver = driverFor(fake.api)
    assert.equal((await driver.test()).state, 'ok')
    assert.equal([...fake.files.keys()].some(key => key.includes('probe')), false)
  } finally {
    await fake.close()
  }
})
