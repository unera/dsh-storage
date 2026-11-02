import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  createS3Driver, parseCredentials, canonicalQuery, canonicalRequest, payloadHash,
  errorForStatus, xmlContents, EMPTY_SHA256, encodeKey,
} from '../s3.mjs'
import { normalizeEntry, readAll, KEEP_FILE } from '../index.mjs'

/**
 * A fake S3 that speaks path-style and enough of the API to exercise the driver:
 * objects, ListObjectsV2, HEAD, DELETE and multipart upload. It does not verify
 * the signature — signature correctness is checked against a real provider, not
 * against a mirror of our own code.
 */
async function startFakeS3() {
  const objects = new Map()
  const uploads = new Map()
  const seen = { auth: [], methods: [] }
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    seen.auth.push(request.headers.authorization ?? '')
    seen.methods.push(request.method)
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const [, bucket, ...rest] = url.pathname.split('/')
    const key = rest.map(decodeURIComponent).join('/')

    if (request.headers.authorization === undefined) {
      response.writeHead(403).end('<Error><Message>no signature</Message></Error>')
      return
    }

    if (request.method === 'POST' && url.searchParams.has('uploads')) {
      const uploadId = `upload-${uploads.size + 1}`
      uploads.set(uploadId, { bucket, key, parts: new Map() })
      response.writeHead(200, { 'content-type': 'application/xml' }).end(`<InitiateMultipartUploadResult><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`)
      return
    }
    if (request.method === 'PUT' && url.searchParams.has('uploadId')) {
      const upload = uploads.get(url.searchParams.get('uploadId'))
      upload.parts.set(Number(url.searchParams.get('partNumber')), body)
      response.writeHead(200, { etag: `"part-${url.searchParams.get('partNumber')}"` }).end()
      return
    }
    if (request.method === 'POST' && url.searchParams.has('uploadId')) {
      const upload = uploads.get(url.searchParams.get('uploadId'))
      const ordered = [...upload.parts.entries()].sort((left, right) => left[0] - right[0]).map(([, part]) => part)
      objects.set(`${upload.bucket}/${upload.key}`, Buffer.concat(ordered))
      uploads.delete(url.searchParams.get('uploadId'))
      response.writeHead(200, { 'content-type': 'application/xml' }).end('<CompleteMultipartUploadResult/>')
      return
    }
    if (request.method === 'PUT') {
      objects.set(`${bucket}/${key}`, body)
      response.writeHead(200).end()
      return
    }
    if (request.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const max = Number(url.searchParams.get('max-keys') ?? '1000')
      const names = [...objects.keys()].filter(name => name.startsWith(`${bucket}/`)).map(name => name.slice(bucket.length + 1))
      const matched = names.filter(name => name.startsWith(prefix)).sort()
      const page = matched.slice(0, max)
      const contents = page.map(name => `<Contents><Key>${name}</Key><Size>${objects.get(`${bucket}/${name}`).length}</Size><LastModified>2026-11-02T18:53:04.000Z</LastModified></Contents>`).join('')
      const truncated = matched.length > page.length
      const xml = `<ListBucketResult>${contents}<IsTruncated>${truncated}</IsTruncated>${truncated ? `<NextContinuationToken>${page.at(-1)}</NextContinuationToken>` : ''}</ListBucketResult>`
      response.writeHead(200, { 'content-type': 'application/xml' }).end(xml)
      return
    }
    if (request.method === 'HEAD') {
      const value = objects.get(`${bucket}/${key}`)
      if (value === undefined) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { 'content-length': String(value.length), 'last-modified': 'Sun, 02 Nov 2026 18:53:04 GMT' }).end()
      return
    }
    if (request.method === 'GET') {
      const value = objects.get(`${bucket}/${key}`)
      if (value === undefined) {
        response.writeHead(404, { 'content-type': 'application/xml' }).end('<Error><Message>NoSuchKey</Message></Error>')
        return
      }
      response.writeHead(200, { 'content-length': String(value.length) }).end(value)
      return
    }
    if (request.method === 'DELETE') {
      objects.delete(`${bucket}/${key}`)
      response.writeHead(204).end()
      return
    }
    response.writeHead(400).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return {
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    seen,
    async close() { await new Promise(resolve => server.close(resolve)) },
  }
}

const CREDENTIALS = JSON.stringify({ accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-example' })

function driverFor(endpoint, options = {}) {
  const entry = normalizeEntry({
    id: 'st-0001',
    type: 's3',
    basePath: 'dsh',
    options: { endpoint, bucket: 'bucket', region: 'ru-central1', ...options },
  }, 0)
  return createS3Driver(entry, { resolveSecret: async () => CREDENTIALS })
}

test('credentials accept JSON, colon form and two lines', () => {
  assert.deepEqual(parseCredentials(CREDENTIALS), { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-example', sessionToken: undefined })
  assert.deepEqual(parseCredentials('id:sec'), { accessKeyId: 'id', secretAccessKey: 'sec' })
  assert.deepEqual(parseCredentials('id\nsec\n'), { accessKeyId: 'id', secretAccessKey: 'sec' })
  assert.throws(() => parseCredentials(''), /no credentials/)
  assert.throws(() => parseCredentials('{"accessKeyId":"a"}'), /accessKeyId and secretAccessKey/)
})

test('the empty body hash is the documented constant', () => {
  assert.equal(payloadHash(undefined), EMPTY_SHA256)
  assert.equal(payloadHash(''), EMPTY_SHA256)
  assert.equal(payloadHash('abc').length, 64)
})

test('query parameters are sorted and encoded', () => {
  const url = new URL('http://h/?b=2&a=1&a=0&c=x y')
  assert.equal(canonicalQuery(url), 'a=0&a=1&b=2&c=x%20y')
})

test('the canonical request has the documented shape', () => {
  const request = canonicalRequest({
    method: 'put',
    path: '/bucket/dsh/a.txt',
    query: '',
    headers: { host: 'h', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20261102T185304Z' },
    signedHeaders: ['host', 'x-amz-content-sha256', 'x-amz-date'],
    payloadHash: EMPTY_SHA256,
  })
  const lines = request.split('\n')
  assert.equal(lines[0], 'PUT')
  assert.equal(lines[1], '/bucket/dsh/a.txt')
  assert.equal(lines[2], '')
  assert.equal(lines[6], '', 'a blank line separates headers from the signed list')
  assert.equal(lines[7], 'host;x-amz-content-sha256;x-amz-date')
  assert.equal(lines[8], EMPTY_SHA256)
})

test('keys are encoded per segment, slashes survive', () => {
  assert.equal(encodeKey('a b/c+d.txt'), 'a%20b/c%2Bd.txt')
})

test('XML listing is parsed into items', () => {
  const xml = '<ListBucketResult><Contents><Key>a/b.txt</Key><Size>12</Size><LastModified>2026-11-02T18:53:04.000Z</LastModified></Contents></ListBucketResult>'
  assert.deepEqual(xmlContents(xml), [{ key: 'a/b.txt', size: 12, mtime: '2026-11-02T18:53:04.000Z' }])
})

test('HTTP statuses map onto the storage vocabulary', () => {
  assert.equal(errorForStatus(403).code, 'FILESTORE_UNAUTHORIZED')
  assert.equal(errorForStatus(401).code, 'FILESTORE_UNAUTHORIZED')
  assert.equal(errorForStatus(404).code, 'FILESTORE_NOT_FOUND')
  assert.equal(errorForStatus(507).code, 'FILESTORE_QUOTA')
  assert.equal(errorForStatus(500).code, 'FILESTORE_ERROR')
})

test('put and get travel through a signed request', async () => {
  const fake = await startFakeS3()
  try {
    const driver = driverFor(fake.endpoint)
    await driver.put('docs/a.txt', 'привет')
    const text = (await readAll(await driver.get('docs/a.txt'))).toString('utf8')
    assert.equal(text, 'привет')
    assert.equal(fake.objects.get('bucket/dsh/docs/a.txt').toString('utf8'), 'привет')
    assert.equal(fake.seen.auth.every(value => value.startsWith('AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE/')), true)
  } finally {
    await fake.close()
  }
})

test('list keeps the base prefix and hides the keep marker', async () => {
  const fake = await startFakeS3()
  try {
    const driver = driverFor(fake.endpoint)
    await driver.put('a.txt', 'a')
    await driver.put('b.txt', 'b')
    await driver.mkdir('empty')
    const { items } = await driver.list('')
    assert.deepEqual(items.map(item => item.key), ['a.txt', 'b.txt'])
  } finally {
    await fake.close()
  }
})

test('mkdir creates a marker object and says so', async () => {
  const fake = await startFakeS3()
  try {
    const driver = driverFor(fake.endpoint)
    const result = await driver.mkdir('sections/assistants')
    assert.equal(result.medium, 'marker')
    assert.equal(result.marker, `sections/assistants/${KEEP_FILE}`)
    assert.equal(fake.objects.has(`bucket/dsh/sections/assistants/${KEEP_FILE}`), true)
  } finally {
    await fake.close()
  }
})

test('stat answers nothing for a missing key', async () => {
  const fake = await startFakeS3()
  try {
    const driver = driverFor(fake.endpoint)
    assert.equal(await driver.stat('nope'), undefined)
    await driver.put('there.txt', 'x')
    const info = await driver.stat('there.txt')
    assert.equal(info.size, 1)
    assert.equal(info.type, 'file')
  } finally {
    await fake.close()
  }
})

test('delete removes the object, and S3 answers 204 even for a missing key', async () => {
  const fake = await startFakeS3()
  try {
    const driver = driverFor(fake.endpoint)
    await driver.put('gone.txt', 'x')
    assert.deepEqual(await driver.delete('gone.txt'), { deleted: true, key: 'gone.txt' })
    // S3 reports success whether or not the key existed, so both calls say the
    // same thing; the local driver is the one that can tell the difference.
    assert.deepEqual(await driver.delete('gone.txt'), { deleted: true, key: 'gone.txt' })
  } finally {
    await fake.close()
  }
})

test('a large file goes up in parts', async () => {
  const fake = await startFakeS3()
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-storage-s3-'))
  try {
    const driver = driverFor(fake.endpoint, { partSize: 1024 })
    const local = path.join(dir, 'big.bin')
    await writeFile(local, Buffer.alloc(4096, 9))
    const written = await driver.putFile('big.bin', local)
    assert.equal(written.size, 4096)
    assert.match(written.sha256, /^[0-9a-f]{64}$/)
    assert.equal(fake.objects.get('bucket/dsh/big.bin').length, 4096)
    assert.equal(fake.seen.methods.filter(method => method === 'PUT').length >= 4, true)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a small file is a single PUT', async () => {
  const fake = await startFakeS3()
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-storage-s3-'))
  try {
    const driver = driverFor(fake.endpoint, { partSize: 1024 * 1024 })
    const local = path.join(dir, 'small.bin')
    await writeFile(local, Buffer.alloc(100, 1))
    await driver.putFile('small.bin', local)
    assert.equal(fake.seen.methods.filter(method => method === 'POST').length, 0)
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('download writes a file and leaves no .part behind', async () => {
  const fake = await startFakeS3()
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-storage-s3-'))
  try {
    const driver = driverFor(fake.endpoint)
    await driver.put('copy.txt', 'body')
    const target = path.join(dir, 'copy.txt')
    const result = await driver.getFile('copy.txt', target)
    assert.equal(result.size, 4)
    assert.equal(await readFile(target, 'utf8'), 'body')
    await assert.rejects(stat(`${target}.part`))
  } finally {
    await fake.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('free space is unknown for S3, not zero', async () => {
  const fake = await startFakeS3()
  try {
    const driver = driverFor(fake.endpoint)
    assert.deepEqual(await driver.free(), { freeBytes: null, totalBytes: null })
  } finally {
    await fake.close()
  }
})

test('the probe test passes against a working bucket', async () => {
  const fake = await startFakeS3()
  try {
    const driver = driverFor(fake.endpoint)
    const result = await driver.test()
    assert.equal(result.state, 'ok')
    assert.equal([...fake.objects.keys()].some(key => key.includes('probe')), false)
  } finally {
    await fake.close()
  }
})
