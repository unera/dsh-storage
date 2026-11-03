/**
 * Dropbox storage driver through the Dropbox v2 REST API.
 * @module @dr-co/dsh-storage/dropbox
 */
import { Readable } from 'node:stream'
import { FilestoreError, KEEP_FILE, normalizeKey } from './index.mjs'

export const DEFAULT_API = 'https://api.dropboxapi.com/2'
export const DEFAULT_CONTENT_API = 'https://content.dropboxapi.com/2'
export const DEFAULT_TOKEN_API = 'https://api.dropboxapi.com/oauth2/token'

export function parseDropboxCredentials(raw) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text === '') throw new FilestoreError('FILESTORE_CREDENTIAL_MISSING', 'Dropbox storage has no token')
  if (!text.startsWith('{')) return { accessToken: text }
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'Dropbox credentials are not valid JSON') }
  const accessToken = parsed.accessToken ?? parsed.access_token
  const refreshToken = parsed.refreshToken ?? parsed.refresh_token
  if (typeof accessToken !== 'string' && typeof refreshToken !== 'string') {
    throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'Dropbox credentials need an access or refresh token')
  }
  return {
    ...(typeof accessToken === 'string' && accessToken.trim() !== '' ? { accessToken: accessToken.trim() } : {}),
    ...(typeof refreshToken === 'string' && refreshToken.trim() !== '' ? { refreshToken: refreshToken.trim() } : {}),
    ...(Number.isFinite(Number(parsed.expiresAt)) ? { expiresAt: Number(parsed.expiresAt) } : {}),
  }
}

export function errorForDropbox(response, body) {
  const summary = typeof body?.error_summary === 'string'
    ? body.error_summary
    : typeof body?.error_description === 'string'
      ? body.error_description
      : body?.error === undefined
        ? ''
        : typeof body.error === 'string' ? body.error : JSON.stringify(body.error)
  const raw = typeof body?.raw === 'string' ? body.raw.slice(0, 300) : ''
  const suffix = summary !== '' ? `: ${summary}` : raw !== '' ? `: ${raw}` : ''
  if (response.status === 401) return new FilestoreError('FILESTORE_UNAUTHORIZED', `Dropbox не принял токен (401)${suffix}`)
  if (response.status === 403) return new FilestoreError('FILESTORE_UNAUTHORIZED', `Dropbox отказал в доступе (403)${suffix}`)
  if (response.status === 404) return new FilestoreError('FILESTORE_NOT_FOUND', `Dropbox: объект не найден (404)${suffix}`)
  if (response.status === 409) return new FilestoreError('FILESTORE_CONFLICT', `Dropbox: конфликт пути (409)${suffix}`)
  if (response.status === 507) return new FilestoreError('FILESTORE_QUOTA', `Dropbox: недостаточно места (507)${suffix}`)
  return new FilestoreError('FILESTORE_ERROR', `Dropbox ответил ${response.status}${suffix}`)
}

export function createDropboxDriver(entry, { resolveSecret, resolveClientSecret, fetchFn = fetch } = {}) {
  const options = entry.options ?? {}
  const api = String(options.api || DEFAULT_API).replace(/\/+$/, '')
  const contentApi = String(options.contentApi || DEFAULT_CONTENT_API).replace(/\/+$/, '')
  const tokenApi = String(options.tokenApi || DEFAULT_TOKEN_API)
  const base = entry.basePath === '' ? '' : normalizeKey(entry.basePath)
  let cached

  const readCredentials = async () => {
    if (typeof resolveSecret !== 'function') throw new FilestoreError('FILESTORE_CREDENTIAL_MISSING', 'no credentials service is available')
    const parsed = parseDropboxCredentials(await resolveSecret())
    if (parsed.refreshToken === undefined) return parsed
    if (cached?.accessToken && cached.expiresAt > Date.now() + 60_000) return cached
    const clientId = String(options.clientId ?? '').trim()
    if (clientId === '' || typeof resolveClientSecret !== 'function') {
      throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'Dropbox refresh token needs app key and app secret')
    }
    const secretRaw = await resolveClientSecret()
    const clientSecret = String(secretRaw ?? '').trim()
    if (clientSecret === '') throw new FilestoreError('FILESTORE_CREDENTIAL_INVALID', 'Dropbox refresh token needs app secret')
    const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: parsed.refreshToken, client_id: clientId, client_secret: clientSecret })
    const response = await fetchFn(tokenApi, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form })
    const text = await response.text().catch(() => '')
    let body
    try { body = text === '' ? {} : JSON.parse(text) } catch { body = { raw: text } }
    if (!response.ok || typeof body.access_token !== 'string') throw errorForDropbox(response, body)
    cached = { accessToken: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 14_400) * 1000 }
    return cached
  }

  const pathFor = key => {
    const normalized = normalizeKey(key)
    const full = [base, normalized].filter(Boolean).join('/')
    return full === '' ? '' : `/${full}`
  }

  const call = async (endpoint, body) => {
    const credentials = await readCredentials()
    const response = await fetchFn(`${api}/${endpoint}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credentials.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await response.text().catch(() => '')
    let parsed
    try { parsed = text === '' ? undefined : JSON.parse(text) } catch { parsed = { raw: text } }
    if (!response.ok) throw errorForDropbox(response, parsed)
    return parsed
  }

  const contentCall = async (endpoint, args, body, contentType = 'application/octet-stream') => {
    const credentials = await readCredentials()
    const response = await fetchFn(`${contentApi}/${endpoint}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${credentials.accessToken}`, 'Dropbox-API-Arg': JSON.stringify(args), 'content-type': contentType },
      body,
    })
    const text = await response.text().catch(() => '')
    let parsed
    try { parsed = text === '' ? undefined : JSON.parse(text) } catch { parsed = { raw: text } }
    if (!response.ok) throw errorForDropbox(response, parsed)
    return parsed
  }

  const driver = {
    id: entry.id,
    type: entry.type,
    capabilities: { put: true, get: true, list: true, stat: true, delete: true, mkdir: true, free: true },

    async list(prefix, listOptions = {}) {
      const normalized = normalizeKey(prefix)
      const limit = Number.isSafeInteger(listOptions.limit) ? Math.max(1, Math.min(listOptions.limit, 2000)) : 100
      const body = await call('files/list_folder', { path: pathFor(normalized), recursive: false, limit })
      const items = (body?.entries ?? []).filter(item => item.name !== KEEP_FILE).map(item => ({
        key: normalized === '' ? item.name : `${normalized}/${item.name}`,
        type: item['.tag'] === 'folder' ? 'directory' : 'file',
        size: item['.tag'] === 'folder' ? 0 : Number(item.size ?? 0),
        mtime: item.server_modified,
      }))
      return { items, truncated: body?.has_more === true }
    },

    async stat(key) {
      const normalized = normalizeKey(key)
      try {
        const body = await call('files/get_metadata', { path: pathFor(normalized) })
        return { key: normalized, type: body?.['.tag'] === 'folder' ? 'directory' : 'file', size: body?.['.tag'] === 'folder' ? 0 : Number(body?.size ?? 0), mtime: body?.server_modified }
      } catch (error) {
        if (error.code === 'FILESTORE_NOT_FOUND') return undefined
        throw error
      }
    },

    async get(key) {
      const credentials = await readCredentials()
      const response = await fetchFn(`${contentApi}/files/download`, { method: 'POST', headers: { authorization: `Bearer ${credentials.accessToken}`, 'Dropbox-API-Arg': JSON.stringify({ path: pathFor(key) }) } })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw errorForDropbox(response, body)
      }
      return response.body === null ? Readable.from([]) : Readable.fromWeb(response.body)
    },

    async put(key, data) {
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'a key is required to write')
      const body = data !== null && typeof data === 'object' && typeof data[Symbol.asyncIterator] === 'function' ? Buffer.concat(await readStream(data)) : data
      await contentCall('files/upload', { path: pathFor(normalized), mode: 'overwrite', autorename: false, mute: true, strict_conflict: false }, body)
      return { key: normalized, size: body === undefined ? 0 : Buffer.byteLength(body) }
    },

    async delete(key) {
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'refusing to delete the whole storage')
      try { await call('files/delete_v2', { path: pathFor(normalized) }); return { deleted: true, key: normalized } } catch (error) {
        if (error.code === 'FILESTORE_NOT_FOUND') return { deleted: false, key: normalized }
        throw error
      }
    },

    async mkdir(key) {
      const normalized = normalizeKey(key)
      await call('files/create_folder_v2', { path: pathFor(normalized), autorename: false }).catch(error => { if (error.code !== 'FILESTORE_CONFLICT') throw error })
      await driver.put(`${normalized}/${KEEP_FILE}`, '')
      return { created: true, key: normalized, medium: 'directory' }
    },

    async free() {
      const body = await call('users/get_space_usage', {})
      const total = Number(body?.allocation?.allocated ?? 0)
      const used = Number(body?.used ?? 0)
      return { freeBytes: Number.isFinite(total) ? Math.max(0, total - used) : null, totalBytes: Number.isFinite(total) ? total : null }
    },

    async test() {
      const startedAt = Date.now()
      const probe = `.dsh-storage-probe-${process.pid}-${Date.now()}`
      await driver.put(probe, 'probe')
      const stream = await driver.get(probe)
      const chunks = []
      for await (const chunk of stream) chunks.push(chunk)
      await driver.delete(probe)
      return { state: Buffer.concat(chunks).toString('utf8') === 'probe' ? 'ok' : 'error', latencyMs: Date.now() - startedAt }
    },
  }
  return driver
}

async function readStream(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return chunks
}
