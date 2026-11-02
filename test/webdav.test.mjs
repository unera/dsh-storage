import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createWebdavDriver, parseWebdavCredentials, parseMultistatus } from '../webdav.mjs'
import { normalizeEntry, readAll, KEEP_FILE } from '../index.mjs'

/**
 * A fake WebDAV: PROPFIND, PUT, GET, HEAD, DELETE, MKCOL over an in-memory tree.
 * Namespace prefixes are the short `D:` kind, which is what Nextcloud sends.
 */
async function startFakeDav() {
  const files = new Map()
  const dirs = new Set([''])
  const calls = []
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const key = decodeURIComponent(url.pathname.replace(/^\/dav\/?/, '')).replace(/\/+$/, '')
    calls.push(`${request.method} ${key}`)
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)

    if (request.headers.authorization !== `Basic ${Buffer.from('u:p').toString('base64')}`) {
      response.writeHead(401).end()
      return
    }
    if (request.method === 'PROPFIND') {
      const wanted = request.headers.depth === '0' ? [key] : [key, ...siblings(key, files, dirs)]
      const blocks = wanted.map(name => {
        const isCollection = dirs.has(name)
        if (!isCollection && !files.has(name)) return ''
        return `<D:response><D:href>/dav/${name === '' ? '' : `${name}${isCollection ? '/' : ''}`}</D:href><D:propstat><D:prop>`
          + `<D:resourcetype>${isCollection ? '<D:collection/>' : ''}</D:resourcetype>`
          + `<D:getcontentlength>${isCollection ? 0 : files.get(name).length}</D:getcontentlength>`
          + '<D:getlastmodified>Sun, 02 Nov 2026 18:53:04 GMT</D:getlastmodified>'
          + '</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>'
      }).filter(Boolean).join('')
      if (blocks === '') {
        response.writeHead(404).end()
        return
      }
      response.writeHead(207, { 'content-type': 'application/xml' }).end(`<D:multistatus xmlns:D="DAV:">${blocks}</D:multistatus>`)
      return
    }
    if (request.method === 'MKCOL') {
      if (dirs.has(key)) {
        response.writeHead(405).end()
        return
      }
      dirs.add(key)
      response.writeHead(201).end()
      return
    }
    if (request.method === 'PUT') {
      const parent = key.includes('/') ? key.slice(0, key.lastIndexOf('/')) : ''
      if (!dirs.has(parent)) {
        response.writeHead(409).end()
        return
      }
      files.set(key, body)
      response.writeHead(201).end()
      return
    }
    if (request.method === 'GET') {
      if (!files.has(key)) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-length': String(files.get(key).length) }).end(files.get(key))
      return
    }
    if (request.method === 'HEAD') {
      response.writeHead(files.has(key) ? 200 : 404, { 'content-length': String(files.get(key)?.length ?? 0) }).end()
      return
    }
    if (request.method === 'DELETE') {
      if (!files.has(key) && !dirs.has(key)) {
        response.writeHead(404).end()
        return
      }
      files.delete(key)
      dirs.delete(key)
      response.writeHead(204).end()
      return
    }
    response.writeHead(400).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}/dav`,
    files,
    dirs,
    calls,
    // undici keeps sockets alive, so `close()` alone never resolves.
    async close() {
      server.closeAllConnections?.()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

/** Direct children of a key, as names inside the fake tree. */
function siblings(key, files, dirs) {
  const prefix = key === '' ? '' : `${key}/`
  return [...new Set([...files.keys(), ...dirs].filter(name => name !== key && name.startsWith(prefix)).map(name => name.slice(prefix.length).split('/')[0]).filter(name => name !== '').map(name => `${prefix}${name}`))]
}

const CREDENTIALS = JSON.stringify({ username: 'u', password: 'p' })

function driverFor(baseUrl, options = {}) {
  const entry = normalizeEntry({ id: 'st-0001', type: 'webdav', options: { baseUrl, ...options } }, 0)
  return createWebdavDriver(entry, { resolveSecret: async () => CREDENTIALS })
}

test('credentials accept JSON, user:pass and two lines', () => {
  assert.deepEqual(parseWebdavCredentials(CREDENTIALS), { username: 'u', password: 'p' })
  assert.deepEqual(parseWebdavCredentials('u:p'), { username: 'u', password: 'p' })
  assert.deepEqual(parseWebdavCredentials('u\np\n'), { username: 'u', password: 'p' })
  assert.throws(() => parseWebdavCredentials(''), /no credentials/)
})

test('a multistatus reply is flattened into rows', () => {
  const xml = `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/dav/a/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop></D:propstat></D:response>`
    + `<D:response><D:href>/dav/a/b.txt</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>7</D:getcontentlength></D:prop></D:propstat></D:response></D:multistatus>`
  const rows = parseMultistatus(xml)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].collection, true)
  assert.equal(rows[1].collection, false)
  assert.equal(rows[1].size, 7)
})

test('put then get returns the bytes', async () => {
  const fake = await startFakeDav()
  try {
    const driver = driverFor(fake.baseUrl)
    await driver.mkdir('docs')
    await driver.put('docs/a.txt', 'привет')
    const text = (await readAll(await driver.get('docs/a.txt'))).toString('utf8')
    assert.equal(text, 'привет')
  } finally {
    await fake.close()
  }
})

test('list shows files and hides the keep marker', async () => {
  const fake = await startFakeDav()
  try {
    const driver = driverFor(fake.baseUrl)
    await driver.mkdir('docs')
    await driver.put('docs/a.txt', 'a')
    await driver.put('docs/b.txt', 'b')
    const { items } = await driver.list('docs')
    assert.deepEqual(items.map(item => item.key).sort(), ['docs/a.txt', 'docs/b.txt'])
  } finally {
    await fake.close()
  }
})

test('stat answers nothing for a missing key', async () => {
  const fake = await startFakeDav()
  try {
    const driver = driverFor(fake.baseUrl)
    assert.equal(await driver.stat('nope.txt'), undefined)
    await driver.mkdir('dir')
    await driver.put('dir/x.txt', 'xyz')
    const info = await driver.stat('dir/x.txt')
    assert.equal(info.size, 3)
    assert.equal(info.type, 'file')
  } finally {
    await fake.close()
  }
})

test('mkdir creates the directory and a keep marker inside it', async () => {
  const fake = await startFakeDav()
  try {
    const driver = driverFor(fake.baseUrl)
    const result = await driver.mkdir('empty')
    assert.equal(result.medium, 'directory')
    assert.equal(fake.dirs.has('empty'), true)
    assert.equal(fake.files.has(`empty/${KEEP_FILE}`), true)
  } finally {
    await fake.close()
  }
})

test('delete removes the object', async () => {
  const fake = await startFakeDav()
  try {
    const driver = driverFor(fake.baseUrl)
    await driver.mkdir('d')
    await driver.put('d/a.txt', 'a')
    assert.deepEqual(await driver.delete('d/a.txt'), { deleted: true, key: 'd/a.txt' })
    assert.equal(fake.files.has('d/a.txt'), false)
  } finally {
    await fake.close()
  }
})

test('upload and download a whole file', async () => {
  const fake = await startFakeDav()
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-storage-dav-'))
  try {
    const driver = driverFor(fake.baseUrl)
    await driver.mkdir('files')
    const local = path.join(dir, 'source.bin')
    await writeFile(local, Buffer.alloc(512, 3))
    const uploaded = await driver.putFile('files/source.bin', local)
    assert.equal(uploaded.size, 512)
    const target = path.join(dir, 'copy.bin')
    const downloaded = await driver.getFile('files/source.bin', target)
    assert.equal(downloaded.size, 512)
    assert.equal(await readFile(target, 'utf8') === Buffer.alloc(512, 3).toString('utf8'), true)
    await assert.rejects(stat(`${target}.part`))
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('free space is unknown when the server does not report a quota', async () => {
  const fake = await startFakeDav()
  try {
    const driver = driverFor(fake.baseUrl)
    assert.deepEqual(await driver.free(), { freeBytes: null, totalBytes: null })
  } finally {
    await fake.close()
  }
})

test('the probe test passes against a working server', async () => {
  const fake = await startFakeDav()
  try {
    const driver = driverFor(fake.baseUrl)
    const result = await driver.test()
    assert.equal(result.state, 'ok')
    assert.equal([...fake.files.keys()].some(name => name.includes('probe')), false)
  } finally {
    await fake.close()
  }
})
