/**
 * The `s3` driver: any S3-compatible object store, spoken over plain `fetch`
 * with AWS Signature Version 4 signed by `node:crypto`.
 *
 * Why not the AWS SDK: a plugin that pulls a 20 MB dependency tree to do five
 * HTTP verbs is a plugin that breaks when the SDK changes its mind. The signing
 * algorithm is stable and short; everything else here is query strings and XML.
 *
 * Two things are deliberately local to this file:
 *   - the credential is read through a callback, because the credentials
 *     service resolves lazily and may mount after the driver is built;
 *   - directories do not exist on S3, so `mkdir` creates the keep object and
 *     says so, instead of pretending a prefix is a folder.
 *
 * @module @dr-co/dsh-storage/s3
 */
import { createHash, createHmac } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import { Readable } from 'node:stream'
import { FilestoreError, KEEP_FILE, normalizeKey } from './index.mjs'

/** Empty body hash, the value S3 expects for bodyless requests. */
export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** Part size for multipart uploads; S3 requires at least 5 MiB except the last part. */
export const DEFAULT_PART_SIZE = 8 * 1024 * 1024

/** Anything larger than this is not read into memory in one go. */
export const MAX_BUFFERED_PUT = 64 * 1024 * 1024

/** Percent-encode one path segment the way SigV4 wants it. */
export function encodeSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** Percent-encode a whole key, keeping the slashes that separate segments. */
export function encodeKey(key) {
  if (key === '') return ''
  return key.split('/').map(encodeSegment).join('/')
}

/** Canonical query string: parameters sorted by encoded name, then encoded value. */
export function canonicalQuery(url) {
  const pairs = [...url.searchParams.entries()]
    .map(([name, value]) => [encodeSegment(name), encodeSegment(value)])
    .sort((left, right) => (left[0] === right[0] ? (left[1] < right[1] ? -1 : 1) : left[0] < right[0] ? -1 : 1))
  return pairs.map(([name, value]) => `${name}=${value}`).join('&')
}

/** The four lines SigV4 hashes. Exported so a test can inspect it. */
export function canonicalRequest({ method, path, query, headers, signedHeaders, payloadHash }) {
  const headerLines = signedHeaders.map(name => `${name}:${String(headers[name] ?? '').trim()}`).join('\n')
  return [method.toUpperCase(), path, query, `${headerLines}\n`, signedHeaders.join(';'), payloadHash].join('\n')
}

/** Derive the signing key for one date, region and service. */
export function signingKey(secretAccessKey, dateStamp, region, service = 's3') {
  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest()
  const kRegion = createHmac('sha256', kDate).update(region).digest()
  const kService = createHmac('sha256', kRegion).update(service).digest()
  return createHmac('sha256', kService).update('aws4_request').digest()
}

/** `20261102T185304Z` and `20261102`, from a Date. */
export function amzDates(now = new Date()) {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

/** SHA-256 of a body, hex. Streams are not accepted: hashing needs the bytes. */
export function payloadHash(body) {
  if (body === undefined || body === null) return EMPTY_SHA256
  if (typeof body === 'string') return createHash('sha256').update(body, 'utf8').digest('hex')
  return createHash('sha256').update(body).digest('hex')
}

/**
 * Sign one request and perform it.
 *
 * @param options.method - HTTP verb.
 * @param options.url - full URL, query included.
 * @param options.body - string, Buffer or undefined.
 * @param options.headers - extra headers to send and sign.
 * @param options.accessKeyId - access key id.
 * @param options.secretAccessKey - secret access key.
 * @param options.region - AWS region, `us-east-1` by default.
 * @param options.fetchFn - replaceable transport, for tests.
 * @param options.now - replaceable clock, for tests.
 * @returns the fetch response.
 */
export async function signedFetch(options) {
  const {
    method, url, body, headers: extra = {}, accessKeyId, secretAccessKey,
    region = 'us-east-1', service = 's3', fetchFn = fetch, now = new Date(), sessionToken,
  } = options
  const target = url instanceof URL ? url : new URL(url)
  const { amzDate, dateStamp } = amzDates(now)
  const hash = payloadHash(body)
  const headers = { host: target.host, 'x-amz-content-sha256': hash, 'x-amz-date': amzDate, ...extra }
  if (sessionToken !== undefined) headers['x-amz-security-token'] = sessionToken
  const signedHeaders = Object.keys(headers).map(name => name.toLowerCase()).sort()
  const request = canonicalRequest({
    method,
    path: target.pathname === '' ? '/' : target.pathname,
    query: canonicalQuery(target),
    headers,
    signedHeaders,
    payloadHash: hash,
  })
  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(request).digest('hex')].join('\n')
  const signature = createHmac('sha256', signingKey(secretAccessKey, dateStamp, region, service)).update(stringToSign).digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`
  return fetchFn(target, { method: method.toUpperCase(), headers: { ...headers, authorization }, body })
}

/** Read the credentials blob: JSON, or `keyId:secret`, or two lines. */
export function parseCredentials(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') throw new FilestoreError('FILESTORE_CREDENTIAL_MISSING', 'S3 storage has no credentials')
  if (text.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'S3 credentials are not valid JSON')
    }
    const accessKeyId = parsed.accessKeyId ?? parsed.accessKey ?? parsed.key
    const secretAccessKey = parsed.secretAccessKey ?? parsed.secret ?? parsed.keySecret
    if (typeof accessKeyId !== 'string' || typeof secretAccessKey !== 'string') {
      throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'S3 credentials need accessKeyId and secretAccessKey')
    }
    return { accessKeyId, secretAccessKey, sessionToken: typeof parsed.sessionToken === 'string' ? parsed.sessionToken : undefined }
  }
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length === 2) return { accessKeyId: lines[0].trim(), secretAccessKey: lines[1].trim() }
  const colon = text.indexOf(':')
  if (colon > 0) return { accessKeyId: text.slice(0, colon), secretAccessKey: text.slice(colon + 1) }
  throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'S3 credentials must be JSON, "keyId:secret" or two lines')
}

/** Minimal XML field reader; enough for ListObjectsV2 and multipart replies. */
export function xmlField(xml, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match === null ? undefined : match[1]
}

/** Every `<Contents>` block of a ListObjectsV2 reply. */
export function xmlContents(xml) {
  const blocks = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []
  return blocks.map(block => ({
    key: decodeXml(xmlField(block, 'Key') ?? ''),
    size: Number(xmlField(block, 'Size') ?? '0'),
    mtime: xmlField(block, 'LastModified'),
  }))
}

/** Unescape the five entities S3 actually emits in keys. */
export function decodeXml(text) {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
}

/** Map an HTTP status onto the storage error vocabulary. */
export function errorForStatus(status, body = '') {
  const detail = (xmlField(body, 'Message') ?? '').trim()
  const suffix = detail === '' ? '' : `: ${detail}`
  if (status === 401 || status === 403) return new FilestoreError('FILESTORE_UNAUTHORIZED', `S3 refused the credentials (${status})${suffix}`)
  if (status === 404) return new FilestoreError('FILESTORE_NOT_FOUND', `S3 has no such object (404)${suffix}`)
  if (status === 507 || /QuotaExceeded|InsufficientStorage/i.test(body)) return new FilestoreError('FILESTORE_QUOTA', `S3 is out of space (${status})${suffix}`)
  if (status === 412) return new FilestoreError('FILESTORE_CONFLICT', `S3 precondition failed (412)${suffix}`)
  return new FilestoreError('FILESTORE_ERROR', `S3 answered ${status}${suffix}`)
}

/** Build the driver for one S3 entry. */
export function createS3Driver(entry, { resolveSecret, fetchFn = fetch, now = () => new Date() } = {}) {
  const options = entry.options ?? {}
  const bucket = typeof options.bucket === 'string' ? options.bucket.trim() : ''
  if (bucket === '') throw new FilestoreError('FILESTORE_BAD_ENTRY', 'an s3 storage needs options.bucket')
  const region = typeof options.region === 'string' && options.region.trim() !== '' ? options.region.trim() : 'us-east-1'
  const endpoint = typeof options.endpoint === 'string' && options.endpoint.trim() !== '' ? options.endpoint.trim().replace(/\/+$/, '') : ''
  const pathStyle = endpoint !== '' ? options.forcePathStyle !== false : options.forcePathStyle === true
  // Real S3 wants at least 5 MiB per part except the last one; smaller values are
  // accepted here for tests and for providers that are more forgiving.
  const partSize = Number.isSafeInteger(options.partSize) && options.partSize >= 1024 ? options.partSize : DEFAULT_PART_SIZE
  const base = entry.basePath === '' ? '' : entry.basePath

  const credentials = async () => {
    if (typeof resolveSecret !== 'function') throw new FilestoreError('FILESTORE_CREDENTIAL_MISSING', 'no credentials service is available')
    const raw = await resolveSecret()
    return parseCredentials(raw)
  }

  /** Absolute URL for a key, respecting path-style and the base prefix. */
  const urlFor = (key, query = {}) => {
    const full = [base, key].filter(part => part !== '').join('/')
    const origin = endpoint === ''
      ? `https://${bucket}.s3.${region}.amazonaws.com`
      : pathStyle ? `${endpoint}/${bucket}` : `${endpoint}`
    const url = new URL(`${origin}/${encodeKey(full)}`.replace(/([^:])\/{2,}/g, '$1/'))
    for (const [name, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(name, String(value))
    return url
  }

  const bucketUrl = () => {
    const origin = endpoint === ''
      ? `https://${bucket}.s3.${region}.amazonaws.com`
      : pathStyle ? `${endpoint}/${bucket}` : `${endpoint}`
    return new URL(origin)
  }

  const send = async (method, url, body, extra) => {
    const credentialsValue = await credentials()
    return signedFetch({
      method, url, body, headers: extra, region, fetchFn, now: now(),
      accessKeyId: credentialsValue.accessKeyId,
      secretAccessKey: credentialsValue.secretAccessKey,
      sessionToken: credentialsValue.sessionToken,
    })
  }

  const fail = async response => {
    const text = await response.text().catch(() => '')
    throw errorForStatus(response.status, text)
  }

  const driver = {
    id: entry.id,
    type: entry.type,
    capabilities: {
      put: true, get: true, list: true, stat: true, delete: true, mkdir: true, free: false,
    },

    async list(prefix, listOptions = {}) {
      const limit = Number.isSafeInteger(listOptions.limit) ? listOptions.limit : 100
      const fullPrefix = [base, normalizeKey(prefix)].filter(part => part !== '').join('/')
      const url = bucketUrl()
      url.searchParams.set('list-type', '2')
      if (fullPrefix !== '') url.searchParams.set('prefix', fullPrefix.endsWith('/') ? fullPrefix : `${fullPrefix}/`)
      url.searchParams.set('max-keys', String(Math.min(limit, 1000)))
      if (typeof listOptions.cursor === 'string' && listOptions.cursor !== '') url.searchParams.set('continuation-token', listOptions.cursor)
      const response = await send('GET', url)
      if (!response.ok) await fail(response)
      const xml = await response.text()
      const strip = key => (base === '' ? key : key.startsWith(`${base}/`) ? key.slice(base.length + 1) : key)
      const items = xmlContents(xml)
        .filter(item => !item.key.endsWith(`/${KEEP_FILE}`) && item.key !== KEEP_FILE)
        .map(item => ({ key: strip(item.key), type: 'file', size: item.size, mtime: item.mtime }))
      const truncated = xmlField(xml, 'IsTruncated') === 'true'
      const cursor = truncated ? xmlField(xml, 'NextContinuationToken') : undefined
      return { items, truncated, ...(cursor === undefined ? {} : { cursor }) }
    },

    async stat(key) {
      const response = await send('HEAD', urlFor(normalizeKey(key)))
      if (response.status === 404) return undefined
      if (!response.ok) await fail(response)
      return {
        key: normalizeKey(key),
        type: 'file',
        size: Number(response.headers.get('content-length') ?? '0'),
        mtime: response.headers.get('last-modified') ?? undefined,
      }
    },

    async get(key) {
      const response = await send('GET', urlFor(normalizeKey(key)))
      if (!response.ok) await fail(response)
      return response.body === null ? Readable.from([]) : Readable.fromWeb(response.body)
    },

    async put(key, data) {
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'a key is required to write')
      let body = data
      if (data !== null && typeof data === 'object' && typeof data[Symbol.asyncIterator] === 'function') {
        body = await readStream(data, MAX_BUFFERED_PUT)
      }
      const response = await send('PUT', urlFor(normalized), body)
      if (!response.ok) await fail(response)
      return { key: normalized, size: body === undefined ? 0 : Buffer.byteLength(body) }
    },

    async putFile(key, localPath) {
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'a key is required to write')
      const info = await fsp.stat(localPath)
      const hash = createHash('sha256')
      await new Promise((resolve, reject) => {
        createReadStream(localPath).on('data', chunk => hash.update(chunk)).on('end', resolve).on('error', reject)
      })
      const sha256 = hash.digest('hex')

      if (info.size <= partSize) {
        const body = await fsp.readFile(localPath)
        const response = await send('PUT', urlFor(normalized), body)
        if (!response.ok) await fail(response)
        return { key: normalized, size: info.size, sha256 }
      }

      const created = await send('POST', urlFor(normalized, { uploads: '' }))
      if (!created.ok) await fail(created)
      const uploadId = xmlField(await created.text(), 'UploadId')
      if (uploadId === undefined) throw new FilestoreError('FILESTORE_ERROR', 'S3 did not return an upload id')

      const parts = []
      try {
        const count = Math.ceil(info.size / partSize)
        for (let index = 0; index < count; index += 1) {
          const start = index * partSize
          const length = Math.min(partSize, info.size - start)
          const body = Buffer.alloc(length)
          const handle = await fsp.open(localPath, 'r')
          try {
            await handle.read(body, 0, length, start)
          } finally {
            await handle.close()
          }
          const partNumber = index + 1
          const response = await send('PUT', urlFor(normalized, { partNumber, uploadId }), body)
          if (!response.ok) await fail(response)
          parts.push({ partNumber, etag: response.headers.get('etag') ?? '' })
        }
        const completion = [
          '<CompleteMultipartUpload>',
          ...parts.map(part => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`),
          '</CompleteMultipartUpload>',
        ].join('')
        const done = await send('POST', urlFor(normalized, { uploadId }), completion, { 'content-type': 'application/xml' })
        if (!done.ok) await fail(done)
        return { key: normalized, size: info.size, sha256 }
      } catch (error) {
        await send('DELETE', urlFor(normalized, { uploadId })).catch(() => {})
        throw error
      }
    },

    async getFile(key, localPath) {
      const normalized = normalizeKey(key)
      const stream = await driver.get(normalized)
      const partial = `${localPath}.part`
      const handle = await fsp.open(partial, 'w')
      try {
        for await (const chunk of stream) await handle.write(chunk)
      } finally {
        await handle.close()
      }
      await fsp.rename(partial, localPath)
      const info = await fsp.stat(localPath)
      return { key: normalized, path: localPath, size: info.size }
    },

    async delete(key, deleteOptions = {}) {
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'refusing to delete the whole storage')
      if (deleteOptions.recursive === true) {
        let cursor
        do {
          const page = await driver.list(normalized, { limit: 1000, cursor })
          for (const item of page.items) {
            const response = await send('DELETE', urlFor(item.key))
            if (!response.ok && response.status !== 404) await fail(response)
          }
          cursor = page.cursor
        } while (cursor !== undefined)
        return { deleted: true, key: normalized }
      }
      const response = await send('DELETE', urlFor(normalized))
      if (response.status === 404) return { deleted: false, key: normalized }
      if (!response.ok) await fail(response)
      return { deleted: true, key: normalized }
    },

    async mkdir(key) {
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'a key is required to create a prefix')
      const markerKey = `${normalized}/${KEEP_FILE}`
      const response = await send('PUT', urlFor(markerKey), Buffer.alloc(0))
      if (!response.ok) await fail(response)
      return { created: true, key: normalized, medium: 'marker', marker: markerKey }
    },

    async free() {
      return { freeBytes: null, totalBytes: null }
    },

    async test() {
      const startedAt = Date.now()
      const probe = `.dsh-storage-probe-${process.pid}-${Date.now()}`
      await driver.put(probe, 'probe')
      const text = (await readStream(await driver.get(probe), 64)).toString('utf8')
      await driver.delete(probe)
      return {
        state: 'ok',
        latencyMs: Date.now() - startedAt,
        message: text === 'probe' ? 'запись, чтение и удаление прошли' : 'чтение вернуло не то, что записали',
      }
    },
  }
  return driver
}

/** Collect a stream into one buffer, refusing to exceed `limit` bytes. */
async function readStream(stream, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of stream) {
    size += chunk.length
    if (size > limit) throw new FilestoreError('FILESTORE_TOO_LARGE', `stream is larger than ${limit} bytes`)
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
