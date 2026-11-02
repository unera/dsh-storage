/**
 * The `webdav` driver: Nextcloud, ownCloud, most NAS boxes and anything else that
 * speaks RFC 4918 over HTTPS.
 *
 * Only what a file store needs: PROPFIND for listing and stat, PUT/GET/DELETE for
 * bytes, MKCOL for directories. Quota is asked for and, when the server does not
 * answer, reported as unknown rather than invented.
 *
 * @module @dr-co/dsh-storage/webdav
 */
import fsp from 'node:fs/promises'
import { Readable } from 'node:stream'
import { FilestoreError, KEEP_FILE, normalizeKey } from './index.mjs'
import { encodeKey } from './s3.mjs'

/** Read a credentials blob: JSON, `user:password`, or two lines. */
export function parseWebdavCredentials(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') throw new FilestoreError('FILESTORE_CREDENTIAL_MISSING', 'webdav storage has no credentials')
  if (text.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'webdav credentials are not valid JSON')
    }
    const username = parsed.username ?? parsed.user ?? parsed.login
    const password = parsed.password ?? parsed.pass ?? parsed.token
    if (typeof username !== 'string' || typeof password !== 'string') {
      throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'webdav credentials need username and password')
    }
    return { username, password }
  }
  const lines = text.split(/\r?\n/).filter(line => line.trim() !== '')
  if (lines.length === 2) return { username: lines[0].trim(), password: lines[1].trim() }
  const colon = text.indexOf(':')
  if (colon > 0) return { username: text.slice(0, colon), password: text.slice(colon + 1) }
  throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'webdav credentials must be JSON, "user:password" or two lines')
}

/** Read one XML tag, ignoring whatever namespace prefix the server chose. */
export function xmlTag(xml, tag) {
  const match = new RegExp(`<(?:[A-Za-z0-9.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9.-]+:)?${tag}>`).exec(xml)
  return match === null ? undefined : match[1]
}

/** Every `<response>` block of a multistatus reply, flattened. */
export function parseMultistatus(xml) {
  const blocks = xml.match(/<(?:[A-Za-z0-9.-]+:)?response[\s>][\s\S]*?<\/(?:[A-Za-z0-9.-]+:)?response>/g) ?? []
  return blocks.map(block => {
    const href = xmlTag(block, 'href') ?? ''
    const collection = /<(?:[A-Za-z0-9.-]+:)?collection\s*\/>/.test(block) || /<D:collection><\/D:collection>/.test(block)
    const size = Number(xmlTag(block, 'getcontentlength') ?? '0')
    const mtime = xmlTag(block, 'getlastmodified')
    return { href, collection, size: Number.isFinite(size) ? size : 0, mtime }
  })
}

/** Percent-decode a path the server returned. */
export function decodeHref(href) {
  try {
    return decodeURIComponent(href)
  } catch {
    return href
  }
}

/** Build the driver for one WebDAV entry. */
export function createWebdavDriver(entry, { resolveSecret, fetchFn = fetch } = {}) {
  const options = entry.options ?? {}
  const baseUrl = typeof options.baseUrl === 'string' ? options.baseUrl.trim().replace(/\/+$/, '') : ''
  if (baseUrl === '') throw new FilestoreError('FILESTORE_BAD_ENTRY', 'a webdav storage needs options.baseUrl')
  const basePath = entry.basePath === '' ? '' : entry.basePath

  const credentials = async () => {
    if (typeof resolveSecret !== 'function') throw new FilestoreError('FILESTORE_CREDENTIAL_MISSING', 'no credentials service is available')
    return parseWebdavCredentials(await resolveSecret())
  }

  const authHeader = async () => {
    const { username, password } = await credentials()
    return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  }

  /** Full URL for a key, with every segment encoded. */
  const urlFor = (key, trailingSlash = false) => {
    const full = [basePath, key].filter(part => part !== '').join('/')
    const encoded = full === '' ? '' : encodeKey(full)
    return `${baseUrl}/${encoded}${trailingSlash && encoded !== '' ? '/' : ''}`
  }

  /** Path relative to the WebDAV root, as the server reports it in href. */
  const stripBase = href => {
    const path = decodeHref(href)
    const root = new URL(baseUrl).pathname.replace(/\/+$/, '')
    let relative = path.startsWith(root) ? path.slice(root.length) : path
    relative = relative.replace(/^\/+/, '')
    if (basePath !== '' && relative.startsWith(`${basePath}/`)) relative = relative.slice(basePath.length + 1)
    return relative.replace(/\/+$/, '')
  }

  const send = async (method, url, { body, headers = {}, depth } = {}) => {
    const authorization = await authHeader()
    return fetchFn(url, {
      method,
      headers: { authorization, ...(depth === undefined ? {} : { depth: String(depth) }), ...headers },
      body,
    })
  }

  const fail = async response => {
    const text = await response.text().catch(() => '')
    const status = response.status
    if (status === 401 || status === 403) throw new FilestoreError('FILESTORE_UNAUTHORIZED', `WebDAV refused the credentials (${status})`)
    if (status === 404) throw new FilestoreError('FILESTORE_NOT_FOUND', `WebDAV has no such object (404)`)
    if (status === 507 || /quota/i.test(text)) throw new FilestoreError('FILESTORE_QUOTA', `WebDAV is out of space (${status})`)
    throw new FilestoreError('FILESTORE_ERROR', `WebDAV answered ${status}`)
  }

  const driver = {
    id: entry.id,
    type: entry.type,
    capabilities: {
      put: true, get: true, list: true, stat: true, delete: true, mkdir: true, free: true,
    },

    async list(prefix, listOptions = {}) {
      const limit = Number.isSafeInteger(listOptions.limit) ? listOptions.limit : 100
      const normalized = normalizeKey(prefix)
      const response = await send('PROPFIND', urlFor(normalized, true), {
        depth: 1,
        headers: { 'content-type': 'application/xml; charset=utf-8' },
        body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/><getlastmodified/></prop></propfind>',
      })
      if (response.status === 404) return { items: [] }
      if (!response.ok && response.status !== 207) await fail(response)
      const xml = await response.text()
      const self = normalized
      const items = []
      for (const row of parseMultistatus(xml)) {
        const key = stripBase(row.href)
        if (key === '' || key === self) continue
        const name = key.split('/').at(-1)
        if (name === KEEP_FILE) continue
        items.push({
          key,
          type: row.collection ? 'directory' : 'file',
          size: row.collection ? 0 : row.size,
          mtime: row.mtime,
        })
      }
      items.sort((left, right) => left.key.localeCompare(right.key))
      const page = items.slice(0, limit)
      return { items: page, truncated: items.length > page.length }
    },

    async stat(key) {
      const normalized = normalizeKey(key)
      const response = await send('PROPFIND', urlFor(normalized), { depth: 0 })
      if (response.status === 404) return undefined
      if (!response.ok && response.status !== 207) await fail(response)
      const row = parseMultistatus(await response.text()).at(0)
      if (row === undefined) return undefined
      return {
        key: normalized,
        type: row.collection ? 'directory' : 'file',
        size: row.collection ? 0 : row.size,
        mtime: row.mtime,
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
      const body = data !== null && typeof data === 'object' && typeof data[Symbol.asyncIterator] === 'function'
        ? Buffer.concat(await readStream(data))
        : data
      const response = await send('PUT', urlFor(normalized), { body })
      if (!response.ok) await fail(response)
      return { key: normalized, size: body === undefined ? 0 : Buffer.byteLength(body) }
    },

    async putFile(key, localPath) {
      const normalized = normalizeKey(key)
      const body = await fsp.readFile(localPath)
      const response = await send('PUT', urlFor(normalized), { body })
      if (!response.ok) await fail(response)
      return { key: normalized, size: body.length }
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
        const { items } = await driver.list(normalized, { limit: 1000 })
        for (const item of items) {
          const response = await send('DELETE', urlFor(item.key, item.type === 'directory'))
          if (!response.ok && response.status !== 404) await fail(response)
        }
      }
      const response = await send('DELETE', urlFor(normalized, true))
      if (response.status === 404) return { deleted: false, key: normalized }
      if (!response.ok) await fail(response)
      return { deleted: true, key: normalized }
    },

    async mkdir(key) {
      const normalized = normalizeKey(key)
      const response = await send('MKCOL', urlFor(normalized, true))
      if (!response.ok && response.status !== 405) await fail(response)
      // A marker file, for the same reason S3 needs one: an empty directory is
      // invisible to some servers and to every listing that filters directories.
      await send('PUT', urlFor(`${normalized === '' ? '' : `${normalized}/`}${KEEP_FILE}`), { body: '' })
      return { created: true, key: normalized, medium: 'directory' }
    },

    async free() {
      const response = await send('PROPFIND', urlFor('', true), {
        depth: 0,
        headers: { 'content-type': 'application/xml; charset=utf-8' },
        body: '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><quota-available-bytes/><quota-used-bytes/></prop></propfind>',
      })
      if (!response.ok && response.status !== 207) return { freeBytes: null, totalBytes: null }
      const xml = await response.text()
      const available = Number(xmlTag(xml, 'quota-available-bytes') ?? 'NaN')
      const used = Number(xmlTag(xml, 'quota-used-bytes') ?? 'NaN')
      if (!Number.isFinite(available) || !Number.isFinite(used)) return { freeBytes: null, totalBytes: null }
      return { freeBytes: available, totalBytes: available + used }
    },

    async test() {
      const startedAt = Date.now()
      const probe = `.dsh-storage-probe-${process.pid}-${Date.now()}`
      await driver.put(probe, 'probe')
      const text = (await readStream(await driver.get(probe))).toString('utf8')
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

/** Collect a stream into one buffer. */
async function readStream(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
