/**
 * The `yadisk` driver: Yandex Disk through its REST API.
 *
 * The API is path-addressed (`disk:/folder/file`), not key-addressed, and it
 * hands out short-lived download and upload links instead of moving bytes
 * itself — so every transfer is two requests, and the second one carries no
 * authorization at all.
 *
 * @module @dr-co/dsh-storage/yadisk
 */
import fsp from 'node:fs/promises'
import { Readable } from 'node:stream'
import { FilestoreError, KEEP_FILE, normalizeKey } from './index.mjs'

/** Default API root. */
export const DEFAULT_API = 'https://cloud-api.yandex.net/v1/disk'

/** Read the credential: a bare OAuth token, or JSON with `token`. */
export function parseYandexCredentials(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') throw new FilestoreError('FILESTORE_CREDENTIAL_MISSING', 'Yandex Disk storage has no token')
  if (text.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'Yandex Disk credentials are not valid JSON')
    }
    const token = parsed.token ?? parsed.access_token ?? parsed.accessToken
    if (typeof token !== 'string' || token.trim() === '') {
      throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'Yandex Disk credentials need a token')
    }
    return token.trim()
  }
  return text
}

/** Map a Yandex API error onto the storage vocabulary. */
export function errorForYandex(response, body) {
  const description = typeof body?.description === 'string' ? body.description : ''
  const suffix = description === '' ? '' : `: ${description}`
  if (response.status === 401) return new FilestoreError('FILESTORE_UNAUTHORIZED', `Яндекс.Диск не принял токен (401)${suffix}`)
  if (response.status === 403) return new FilestoreError('FILESTORE_UNAUTHORIZED', `Яндекс.Диск отказал в доступе (403)${suffix}`)
  if (response.status === 404) return new FilestoreError('FILESTORE_NOT_FOUND', `Яндекс.Диск: объекта нет (404)${suffix}`)
  if (response.status === 507 || /quota|места/i.test(description)) return new FilestoreError('FILESTORE_QUOTA', `Яндекс.Диск переполнен${suffix}`)
  if (response.status === 409) return new FilestoreError('FILESTORE_CONFLICT', `Яндекс.Диск: путь занят (409)${suffix}`)
  return new FilestoreError('FILESTORE_ERROR', `Яндекс.Диск ответил ${response.status}${suffix}`)
}

/** Build the driver for one Yandex Disk entry. */
export function createYandexDriver(entry, { resolveSecret, fetchFn = fetch } = {}) {
  const options = entry.options ?? {}
  const api = typeof options.api === 'string' && options.api.trim() !== '' ? options.api.trim().replace(/\/+$/, '') : DEFAULT_API
  const base = entry.basePath === '' ? '' : entry.basePath

  const token = async () => {
    if (typeof resolveSecret !== 'function') throw new FilestoreError('FILESTORE_CREDENTIAL_MISSING', 'no credentials service is available')
    return parseYandexCredentials(await resolveSecret())
  }

  /** `disk:/base/key`, the form the API wants. */
  const pathFor = key => {
    const full = [base, key].filter(part => part !== '').join('/')
    return full === '' ? 'disk:/' : `disk:/${full}`
  }

  const call = async (method, url, body) => {
    const headers = { authorization: `OAuth ${await token()}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetchFn(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      let parsed
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
      throw errorForYandex(response, parsed)
    }
    if (response.status === 204) return undefined
    const text = await response.text()
    return text === '' ? undefined : JSON.parse(text)
  }

  const driver = {
    id: entry.id,
    type: entry.type,
    capabilities: {
      put: true, get: true, list: true, stat: true, delete: true, mkdir: true, free: true,
    },

    async list(prefix, listOptions = {}) {
      const limit = Number.isSafeInteger(listOptions.limit) ? listOptions.limit : 100
      const offset = Number.isSafeInteger(listOptions.offset) ? listOptions.offset : 0
      const normalized = normalizeKey(prefix)
      const url = `${api}/resources?path=${encodeURIComponent(pathFor(normalized))}&limit=${limit}&offset=${offset}&sort=name`
      let body
      try {
        body = await call('GET', url)
      } catch (error) {
        if (error.code === 'FILESTORE_NOT_FOUND') return { items: [] }
        throw error
      }
      const embedded = body?._embedded?.items ?? []
      const items = []
      for (const item of embedded) {
        const name = String(item.name ?? '')
        if (name === KEEP_FILE) continue
        const key = normalized === '' ? name : `${normalized}/${name}`
        items.push({
          key,
          type: item.type === 'dir' ? 'directory' : 'file',
          size: item.type === 'dir' ? 0 : Number(item.size ?? 0),
          mtime: item.modified,
        })
      }
      const total = Number(body?._embedded?.total ?? items.length)
      return { items, truncated: items.length < total }
    },

    async stat(key) {
      const normalized = normalizeKey(key)
      try {
        const body = await call('GET', `${api}/resources?path=${encodeURIComponent(pathFor(normalized))}&fields=name,type,size,modified`)
        if (body === undefined) return undefined
        return {
          key: normalized,
          type: body.type === 'dir' ? 'directory' : 'file',
          size: body.type === 'dir' ? 0 : Number(body.size ?? 0),
          mtime: body.modified,
        }
      } catch (error) {
        if (error.code === 'FILESTORE_NOT_FOUND') return undefined
        throw error
      }
    },

    async get(key) {
      const link = await call('GET', `${api}/resources/download?path=${encodeURIComponent(pathFor(normalizeKey(key)))}`)
      if (typeof link?.href !== 'string') throw new FilestoreError('FILESTORE_ERROR', 'Яндекс.Диск не выдал ссылку на скачивание')
      const response = await fetchFn(link.href)
      if (!response.ok) throw errorForYandex(response, undefined)
      return response.body === null ? Readable.from([]) : Readable.fromWeb(response.body)
    },

    async put(key, data) {
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'a key is required to write')
      const body = data !== null && typeof data === 'object' && typeof data[Symbol.asyncIterator] === 'function'
        ? Buffer.concat(await readStream(data))
        : data
      // GET, not PUT: the API hands out the upload link in response to a GET, and
      // answers 403 Forbidden to anything else. The bytes go to the link itself.
      const link = await call('GET', `${api}/resources/upload?path=${encodeURIComponent(pathFor(normalized))}&overwrite=true`)
      if (typeof link?.href !== 'string') throw new FilestoreError('FILESTORE_ERROR', 'Яндекс.Диск не выдал ссылку на загрузку')
      const response = await fetchFn(link.href, { method: 'PUT', body })
      if (!response.ok) throw errorForYandex(response, undefined)
      return { key: normalized, size: body === undefined ? 0 : Buffer.byteLength(body) }
    },

    async putFile(key, localPath) {
      const normalized = normalizeKey(key)
      const body = await fsp.readFile(localPath)
      return driver.put(normalized, body)
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
      try {
        await call('DELETE', `${api}/resources?path=${encodeURIComponent(pathFor(normalized))}&permanently=${deleteOptions.recursive === true ? 'true' : 'false'}`)
        return { deleted: true, key: normalized }
      } catch (error) {
        if (error.code === 'FILESTORE_NOT_FOUND') return { deleted: false, key: normalized }
        throw error
      }
    },

    async mkdir(key) {
      const normalized = normalizeKey(key)
      try {
        await call('PUT', `${api}/resources?path=${encodeURIComponent(pathFor(normalized))}`)
      } catch (error) {
        // 409 means the directory is already there, which is what we wanted.
        if (error.code !== 'FILESTORE_CONFLICT') throw error
      }
      // Same reason as everywhere else: an empty directory must stay visible.
      await driver.put(`${normalized === '' ? '' : `${normalized}/`}${KEEP_FILE}`, '').catch(() => {})
      return { created: true, key: normalized, medium: 'directory' }
    },

    async free() {
      const body = await call('GET', `${api}/?fields=total_space,used_space`)
      const total = Number(body?.total_space)
      const used = Number(body?.used_space)
      if (!Number.isFinite(total) || !Number.isFinite(used)) return { freeBytes: null, totalBytes: null }
      return { freeBytes: total - used, totalBytes: total }
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
