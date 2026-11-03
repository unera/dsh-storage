/**
 * The `gdrive` driver: Google Drive through the Drive v3 REST API.
 *
 * Drive has no paths — every object is an id, and a "folder" is just a file with
 * a folder MIME type. Our keys are paths, so they are resolved to ids by walking
 * the segments from a configured folder, and the walk is cached: without the
 * cache a listing of ten files would cost ten extra requests.
 *
 * @module @dr-co/dsh-storage/gdrive
 */
import fsp from 'node:fs/promises'
import { Readable } from 'node:stream'
import { FilestoreError, KEEP_FILE, normalizeKey } from './index.mjs'

/** API root for metadata calls. */
export const DEFAULT_API = 'https://www.googleapis.com/drive/v3'

/** Separate root for uploads; Drive insists on the /upload prefix. */
export const DEFAULT_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

/** The MIME type that makes a file behave like a folder. */
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Read the credential: a bare access token, or JSON with `accessToken`. */
export function parseGoogleCredentials(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') throw new FilestoreError('FILESTORE_CREDENTIAL_MISSING', 'Google Drive storage has no access token')
  if (text.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'Google Drive credentials are not valid JSON')
    }
    const token = parsed.accessToken ?? parsed.access_token ?? parsed.token
    if (typeof token !== 'string' || token.trim() === '') {
      throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'Google Drive credentials need an access token')
    }
    return token.trim()
  }
  return text
}

/** Map a Drive error body onto the storage vocabulary. */
export function errorForGoogle(status, body) {
  const message = body?.error?.message ?? body?.error_description ?? ''
  const suffix = message === '' ? '' : `: ${message}`
  if (status === 401) return new FilestoreError('FILESTORE_UNAUTHORIZED', `Google не принял токен (401)${suffix}`)
  if (status === 403) {
    if (/quota|storage quota/i.test(message)) return new FilestoreError('FILESTORE_QUOTA', `Google: место кончилось${suffix}`)
    return new FilestoreError('FILESTORE_UNAUTHORIZED', `Google отказал в доступе (403)${suffix}`)
  }
  if (status === 404) return new FilestoreError('FILESTORE_NOT_FOUND', `Google: объекта нет (404)${suffix}`)
  if (status === 409) return new FilestoreError('FILESTORE_CONFLICT', `Google: конфликт имени (409)${suffix}`)
  return new FilestoreError('FILESTORE_ERROR', `Google ответил ${status}${suffix}`)
}

/** Escape a name for a Drive `q` query: single quotes and backslashes. */
export function escapeQuery(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")
}

/** Build the driver for one Google Drive entry. */
export function createGoogleDriver(entry, { resolveSecret, fetchFn = fetch } = {}) {
  const options = entry.options ?? {}
  const api = typeof options.api === 'string' && options.api.trim() !== '' ? options.api.trim().replace(/\/+$/, '') : DEFAULT_API
  const uploadApi = typeof options.uploadApi === 'string' && options.uploadApi.trim() !== '' ? options.uploadApi.trim().replace(/\/+$/, '') : DEFAULT_UPLOAD_API
  const rootId = typeof options.folderId === 'string' && options.folderId.trim() !== '' ? options.folderId.trim() : 'root'
  const base = entry.basePath === '' ? '' : entry.basePath
  /** path → id, so a listing does not re-walk the same folders. */
  const folderCache = new Map([[base, rootId]])

  const token = async () => {
    if (typeof resolveSecret !== 'function') throw new FilestoreError('FILESTORE_CREDENTIAL_MISSING', 'no credentials service is available')
    return parseGoogleCredentials(await resolveSecret())
  }

  const call = async (url, init = {}) => {
    const headers = { authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) }
    const response = await fetchFn(url, { ...init, headers })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
      throw errorForGoogle(response.status, parsed)
    }
    if (response.status === 204) return undefined
    const text = await response.text()
    return text === '' ? undefined : JSON.parse(text)
  }

  /** Find a child by name inside a folder; `undefined` when it is not there. */
  const findChild = async (parentId, name) => {
    const q = `name = '${escapeQuery(name)}' and '${escapeQuery(parentId)}' in parents and trashed = false`
    const url = `${api}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,mimeType,size,modifiedTime)')}&pageSize=10`
    const body = await call(url)
    return (body?.files ?? []).find(file => file.name === name)
  }

  /** Create a folder and return its id. */
  const createFolder = async (parentId, name) => {
    const body = await call(`${api}/files?fields=id,name`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    })
    return body.id
  }

  /**
   * Resolve a key to its id, creating parents only when asked.
   *
   * @param key - normalized key.
   * @param create - create missing folders on the way.
   * @returns the id, or `undefined` when a segment is missing and `create` is off.
   */
  const resolveId = async (key, create = false) => {
    if (key === '') return rootId
    const segments = key.split('/')
    let parentId = rootId
    let path = base
    for (const [index, segment] of segments.entries()) {
      path = path === '' ? segment : `${path}/${segment}`
      const last = index === segments.length - 1
      if (!last && folderCache.has(path)) {
        parentId = folderCache.get(path)
        continue
      }
      const found = await findChild(parentId, segment)
      if (found === undefined) {
        if (!create || !last) return undefined
        parentId = await createFolder(parentId, segment)
        folderCache.set(path, parentId)
        return parentId
      }
      if (!last) {
        if (found.mimeType !== FOLDER_MIME) return undefined
        parentId = found.id
        folderCache.set(path, parentId)
        continue
      }
      return found.id
    }
    return parentId
  }

  /** Create every missing folder of a key, like `mkdir -p`. */
  const ensureParents = async key => {
    const segments = key.split('/').slice(0, -1)
    let parentId = rootId
    let path = base
    for (const segment of segments) {
      path = path === '' ? segment : `${path}/${segment}`
      const cached = folderCache.get(path)
      if (cached !== undefined) {
        parentId = cached
        continue
      }
      const found = await findChild(parentId, segment)
      if (found !== undefined && found.mimeType === FOLDER_MIME) {
        parentId = found.id
        folderCache.set(path, found.id)
        continue
      }
      parentId = await createFolder(parentId, segment)
      folderCache.set(path, parentId)
    }
    return parentId
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
      const folderId = normalized === '' ? (await resolveId('')) : await resolveId(normalized)
      if (folderId === undefined) return { items: [] }
      const q = `'${escapeQuery(folderId)}' in parents and trashed = false`
      const url = `${api}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,mimeType,size,modifiedTime)')}&pageSize=${Math.min(limit, 1000)}`
      const body = await call(url)
      const items = []
      for (const file of body?.files ?? []) {
        if (file.name === KEEP_FILE) continue
        const key = normalized === '' ? file.name : `${normalized}/${file.name}`
        const isFolder = file.mimeType === FOLDER_MIME
        if (isFolder) folderCache.set(base === '' ? key : `${base}/${key}`, file.id)
        items.push({
          key,
          type: isFolder ? 'directory' : 'file',
          size: isFolder ? 0 : Number(file.size ?? 0),
          mtime: file.modifiedTime,
        })
      }
      items.sort((left, right) => left.key.localeCompare(right.key))
      return { items, truncated: items.length >= limit }
    },

    async stat(key) {
      const normalized = normalizeKey(key)
      const id = await resolveId(normalized)
      if (id === undefined) return undefined
      if (normalized === '') return { key: '', type: 'directory', size: 0 }
      const url = `${api}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent('id,name,mimeType,size,modifiedTime')}`
      const body = await call(url).catch(error => {
        if (error.code === 'FILESTORE_NOT_FOUND') return undefined
        throw error
      })
      if (body === undefined) return undefined
      const isFolder = body.mimeType === FOLDER_MIME
      return { key: normalized, type: isFolder ? 'directory' : 'file', size: isFolder ? 0 : Number(body.size ?? 0), mtime: body.modifiedTime }
    },

    async get(key) {
      const normalized = normalizeKey(key)
      const id = await resolveId(normalized)
      if (id === undefined) throw new FilestoreError('FILESTORE_NOT_FOUND', `${normalized} is not there`)
      const headers = { authorization: `Bearer ${await token()}` }
      const response = await fetchFn(`${api}/files/${encodeURIComponent(id)}?alt=media`, { headers })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw errorForGoogle(response.status, text.startsWith('{') ? JSON.parse(text) : undefined)
      }
      return response.body === null ? Readable.from([]) : Readable.fromWeb(response.body)
    },

    async put(key, data) {
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'a key is required to write')
      const body = data !== null && typeof data === 'object' && typeof data[Symbol.asyncIterator] === 'function'
        ? Buffer.concat(await readStream(data))
        : data
      const parentId = await ensureParents(normalized)
      const name = normalized.split('/').at(-1)
      const existing = await findChild(parentId, name)
      const boundary = 'dsh-storage-boundary'
      const metadata = JSON.stringify(existing === undefined ? { name, parents: [parentId] } : { name })
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
        Buffer.isBuffer(body) ? body : Buffer.from(body ?? ''),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ])
      const url = existing === undefined
        ? `${uploadApi}/files?uploadType=multipart&fields=id`
        : `${uploadApi}/files/${encodeURIComponent(existing.id)}?uploadType=multipart&fields=id`
      const response = await fetchFn(url, {
        method: existing === undefined ? 'POST' : 'PATCH',
        headers: { authorization: `Bearer ${await token()}`, 'content-type': `multipart/related; boundary=${boundary}` },
        body: payload,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw errorForGoogle(response.status, text.startsWith('{') ? JSON.parse(text) : undefined)
      }
      return { key: normalized, size: payload.length === 0 ? 0 : (Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body ?? '')) }
    },

    async putFile(key, localPath) {
      const body = await fsp.readFile(localPath)
      return driver.put(key, body)
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
      const id = await resolveId(normalized)
      if (id === undefined) return { deleted: false, key: normalized }
      if (deleteOptions.recursive !== true) {
        const info = await driver.stat(normalized)
        if (info?.type === 'directory') throw new FilestoreError('FILESTORE_IS_DIRECTORY', `${normalized} is a directory; pass recursive to delete it`)
      }
      await call(`${api}/files/${encodeURIComponent(id)}`, { method: 'DELETE' })
      return { deleted: true, key: normalized }
    },

    async mkdir(key) {
      const normalized = normalizeKey(key)
      const id = await resolveId(normalized, true)
      if (id !== undefined) folderCache.set(base === '' ? normalized : `${base}/${normalized}`, id)
      // The marker keeps an empty folder visible in tools that only count files.
      await driver.put(`${normalized === '' ? '' : `${normalized}/`}${KEEP_FILE}`, '').catch(() => {})
      return { created: true, key: normalized, medium: 'directory' }
    },

    async free() {
      const body = await call(`${api}/about?fields=storageQuota`)
      const quota = body?.storageQuota
      const limit = Number(quota?.limit)
      const usage = Number(quota?.usage)
      if (!Number.isFinite(limit) || !Number.isFinite(usage)) return { freeBytes: null, totalBytes: null }
      return { freeBytes: limit - usage, totalBytes: limit }
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
