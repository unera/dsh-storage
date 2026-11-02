/**
 * Remote disks for DeepSeek Harness.
 *
 * A storage entry is one configured place the model can read and write files:
 * a directory on this host, an S3 bucket, a WebDAV share. Entries are added in
 * the settings panel, exactly like web-search providers, and one of them can be
 * marked primary — the default target when a tool call does not name one.
 *
 * Everything the model sees goes through four ideas:
 *   - `ctx.filestore` is the seam; drivers only move bytes;
 *   - every secret lives in `ctx.credentials`, never in the settings document;
 *   - a key is a POSIX path inside `basePath`, never an absolute path;
 *   - a driver declares what it can do, and the UI does not offer the rest.
 *
 * @module @dr-co/dsh-storage
 */
import { Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { createReadStream } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
// Imported at the top even though `s3.mjs` imports primitives back from here: the
// cycle is harmless because neither module touches the other at evaluation time,
// and the host half is shipped as plain ESM, never bundled.
import { createS3Driver } from './s3.mjs'
import { createWebdavDriver } from './webdav.mjs'

/** Stable Loader identity. */
export const name = 'dsh-storage'

/** Settings namespace owning the entry list. */
export const SETTINGS_NAMESPACE = 'dsh-storage'

/** Prefix the admin API is mounted under. */
export const ROUTE_PREFIX = '/__fs'

/** A key longer than this is a mistake, not a file name. */
export const MAX_KEY_LENGTH = 1024

/** Largest slice of a file handed to the model in one `storage_read`. */
export const MAX_READ_BYTES = 256 * 1024

/**
 * A directory cannot be created on a medium that has no directories. Creating
 * this object is what makes the prefix exist on S3, and it is what keeps an
 * empty section visible instead of silently absent. It is never listed as data
 * and never packed into an archive.
 */
export const KEEP_FILE = '.dsh-storage-keep'

/** Driver types this build can actually run. */
export const PROVIDER_TYPES = Object.freeze(['local', 's3', 'webdav'])

/**
 * What each type can do. The UI asks before drawing a button, and the host
 * answers `FILESTORE_UNSUPPORTED` instead of pretending a no-op succeeded.
 */
export const CAPABILITIES = Object.freeze({
  local: Object.freeze({
    put: true, get: true, list: true, stat: true, delete: true, mkdir: true, free: true,
  }),
  s3: Object.freeze({
    put: true, get: true, list: true, stat: true, delete: true, mkdir: true, free: false,
  }),
  webdav: Object.freeze({
    put: true, get: true, list: true, stat: true, delete: true, mkdir: true, free: true,
  }),
})

/** Entry states reported by `status()`. */
export const STATES = Object.freeze(['ok', 'disabled', 'unauthorized', 'unreachable', 'not-found', 'quota', 'error', 'unknown'])

/** Error carrying a stable code the model and the UI may switch on. */
export class FilestoreError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'FilestoreError'
    this.code = code
  }
}

/**
 * Normalize a key: forward slashes, no leading slash, no `.`/`..`, no NUL.
 * An empty result means the root of the storage.
 *
 * @param key - raw key from a tool call or the admin API.
 * @returns the normalized key, possibly empty.
 */
export function normalizeKey(key) {
  if (key === undefined || key === null) return ''
  if (typeof key !== 'string') throw new FilestoreError('FILESTORE_BAD_KEY', 'a key must be a string')
  if (key.includes('\0')) throw new FilestoreError('FILESTORE_BAD_KEY', 'a key cannot contain NUL')
  const trimmed = key.replaceAll('\\', '/').trim()
  const withoutLeading = trimmed.replace(/^\/+/, '')
  if (withoutLeading.length > MAX_KEY_LENGTH) {
    throw new FilestoreError('FILESTORE_BAD_KEY', `a key cannot be longer than ${MAX_KEY_LENGTH} characters`)
  }
  if (withoutLeading === '') return ''
  for (const segment of withoutLeading.split('/')) {
    if (segment === '.' || segment === '..') {
      throw new FilestoreError('FILESTORE_BAD_KEY', `a key cannot contain ${JSON.stringify(segment)}`)
    }
    if (segment === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'a key cannot contain an empty segment')
  }
  return withoutLeading
}

/** Stable id for an entry position; renaming an entry never changes it. */
export function makeEntryId(index) {
  return `st-${String(index + 1).padStart(4, '0')}`
}

/** Credential reference derived from an entry id, never stored in `options`. */
export function makeCredentialRef(id) {
  return credentialRef(`DSH_FILESTORE_${String(id).toUpperCase().replaceAll('-', '_')}`)
}

/**
 * Shape a stored entry into the one the host uses: a known type, a stable id,
 * a credential reference, a base path. Unknown types are dropped here instead
 * of being carried around and failing later.
 *
 * @param raw - entry as it sits in the settings document.
 * @param index - position in the list, used when the id is missing.
 * @returns a normalized entry, or `undefined` when the type is unknown.
 */
export function normalizeEntry(raw, index) {
  if (raw === null || typeof raw !== 'object') return undefined
  const type = typeof raw.type === 'string' ? raw.type : 'local'
  if (!PROVIDER_TYPES.includes(type)) return undefined
  const id = typeof raw.id === 'string' && raw.id.trim() !== '' ? raw.id.trim() : makeEntryId(index)
  return {
    id,
    type,
    label: typeof raw.label === 'string' && raw.label.trim() !== '' ? raw.label.trim() : `${type} ${id}`,
    enabled: raw.enabled !== false,
    role: raw.role === 'primary' ? 'primary' : 'secondary',
    readOnly: raw.readOnly === true,
    basePath: normalizeBasePath(raw.basePath),
    credentialRef: typeof raw.credentialRef === 'string' && raw.credentialRef.trim() !== ''
      ? credentialRef(raw.credentialRef.trim())
      : makeCredentialRef(id),
    options: raw.options !== null && typeof raw.options === 'object' ? { ...raw.options } : {},
  }
}

/** A base path is a relative POSIX path; empty means the storage root. */
export function normalizeBasePath(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (trimmed === '') return ''
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new FilestoreError('FILESTORE_BAD_BASE_PATH', `a base path cannot contain ${JSON.stringify(segment)}`)
    }
  }
  return trimmed
}

/**
 * Normalize a whole list and enforce the primary invariant: at most one entry
 * is primary. When several claim it the first one keeps it, because silently
 * losing the flag is worse than picking the first.
 *
 * @param list - entries from the settings document or the plugin config.
 * @returns `{ entries, demoted }` where `demoted` lists ids that lost the flag.
 */
export function normalizeEntries(list) {
  const raw = Array.isArray(list) ? list : []
  const entries = []
  for (const [index, item] of raw.entries()) {
    const entry = normalizeEntry(item, index)
    if (entry !== undefined) entries.push(entry)
  }
  const demoted = []
  let seenPrimary = false
  for (const entry of entries) {
    if (entry.role !== 'primary') continue
    if (seenPrimary) {
      entry.role = 'secondary'
      demoted.push(entry.id)
    } else {
      seenPrimary = true
    }
  }
  return { entries, demoted }
}

/**
 * Resolve a key inside a storage root without ever leaving it.
 *
 * @param root - absolute directory the storage lives in.
 * @param key - normalized key.
 * @returns the absolute path.
 */
export function resolveInside(root, key) {
  const base = path.resolve(root)
  const target = key === '' ? base : path.resolve(base, key)
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new FilestoreError('FILESTORE_BAD_KEY', 'the key resolves outside the storage root')
  }
  return target
}

/** Whether a directory listing entry is our own marker rather than data. */
export function isKeepFile(entryName) {
  return entryName === KEEP_FILE
}

/**
 * The `local` driver: a directory on this host.
 *
 * @param entry - normalized storage entry; `options.root` must be absolute.
 * @returns a driver object implementing the storage contract.
 */
export function createLocalDriver(entry) {
  const root = typeof entry.options.root === 'string' ? entry.options.root.trim() : ''
  if (root === '') throw new FilestoreError('FILESTORE_BAD_ENTRY', 'a local storage needs options.root')
  if (!path.isAbsolute(root)) throw new FilestoreError('FILESTORE_BAD_ENTRY', 'options.root must be an absolute path')
  const base = entry.basePath === '' ? path.resolve(root) : resolveInside(root, entry.basePath)
  const at = key => (key === '' ? base : resolveInside(base, key))
  const guardWrite = () => {
    if (entry.readOnly) throw new FilestoreError('FILESTORE_READ_ONLY', `storage ${entry.id} is read-only`)
  }

  const driver = {
    id: entry.id,
    type: entry.type,
    capabilities: CAPABILITIES.local,
    root: base,

    async list(prefix, options = {}) {
      const limit = Number.isSafeInteger(options.limit) ? options.limit : 100
      const directory = at(normalizeKey(prefix))
      let names
      try {
        names = await fsp.readdir(directory, { withFileTypes: true })
      } catch (error) {
        if (error?.code === 'ENOENT') return { items: [] }
        throw toFilestoreError(error)
      }
      const items = []
      for (const dirent of names) {
        if (isKeepFile(dirent.name)) continue
        const absolute = path.join(directory, dirent.name)
        const info = await fsp.stat(absolute).catch(() => undefined)
        if (info === undefined) continue
        const key = path.posix.join(normalizeKey(prefix), dirent.name)
        items.push({
          key,
          type: dirent.isDirectory() ? 'directory' : 'file',
          size: dirent.isDirectory() ? 0 : info.size,
          mtime: info.mtime.toISOString(),
        })
        if (!options.recursive) continue
      }
      items.sort((left, right) => left.key.localeCompare(right.key))
      const page = items.slice(0, limit)
      return { items: page, truncated: items.length > page.length }
    },

    async stat(key) {
      const target = at(normalizeKey(key))
      try {
        const info = await fsp.stat(target)
        return {
          key: normalizeKey(key),
          type: info.isDirectory() ? 'directory' : 'file',
          size: info.isDirectory() ? 0 : info.size,
          mtime: info.mtime.toISOString(),
        }
      } catch (error) {
        if (error?.code === 'ENOENT') return undefined
        throw toFilestoreError(error)
      }
    },

    async get(key) {
      const target = at(normalizeKey(key))
      try {
        const info = await fsp.stat(target)
        if (info.isDirectory()) throw new FilestoreError('FILESTORE_IS_DIRECTORY', `${key} is a directory`)
      } catch (error) {
        if (error?.code === 'ENOENT') throw new FilestoreError('FILESTORE_NOT_FOUND', `${key} is not there`)
        throw toFilestoreError(error)
      }
      return createReadStream(target)
    },

    async put(key, data) {
      guardWrite()
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'a key is required to write')
      const target = at(normalized)
      await fsp.mkdir(path.dirname(target), { recursive: true })
      const partial = `${target}.part`
      try {
        if (typeof data === 'string' || data instanceof Uint8Array) {
          await fsp.writeFile(partial, data)
        } else {
          await pipeline(data, fsp.open(partial, 'w').then(handle => handle.createWriteStream()))
        }
        await fsp.rename(partial, target)
      } catch (error) {
        await fsp.rm(partial, { force: true }).catch(() => {})
        throw toFilestoreError(error)
      }
      const info = await fsp.stat(target)
      return { key: normalized, size: info.size }
    },

    async putFile(key, localPath) {
      guardWrite()
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'a key is required to write')
      const target = at(normalized)
      await fsp.mkdir(path.dirname(target), { recursive: true })
      const partial = `${target}.part`
      try {
        await fsp.copyFile(localPath, partial)
        await fsp.rename(partial, target)
      } catch (error) {
        await fsp.rm(partial, { force: true }).catch(() => {})
        throw toFilestoreError(error)
      }
      return driver.describeWritten(normalized, target)
    },

    async getFile(key, localPath) {
      const normalized = normalizeKey(key)
      const source = at(normalized)
      const partial = `${localPath}.part`
      try {
        await fsp.copyFile(source, partial)
        await fsp.rename(partial, localPath)
      } catch (error) {
        await fsp.rm(partial, { force: true }).catch(() => {})
        throw toFilestoreError(error)
      }
      const info = await fsp.stat(localPath)
      return { key: normalized, path: localPath, size: info.size }
    },

    async describeWritten(key, absolute) {
      const info = await fsp.stat(absolute)
      const hash = createHash('sha256')
      await pipeline(createReadStream(absolute), hash)
      return { key, size: info.size, sha256: hash.digest('hex') }
    },

    async delete(key, options = {}) {
      guardWrite()
      const normalized = normalizeKey(key)
      if (normalized === '') throw new FilestoreError('FILESTORE_BAD_KEY', 'refusing to delete the storage root')
      const target = at(normalized)
      let info
      try {
        info = await fsp.lstat(target)
      } catch (error) {
        if (error?.code === 'ENOENT') return { deleted: false, key: normalized }
        throw toFilestoreError(error)
      }
      if (info.isDirectory() && options.recursive !== true) {
        throw new FilestoreError('FILESTORE_IS_DIRECTORY', `${normalized} is a directory; pass recursive to delete it`)
      }
      await fsp.rm(target, { recursive: info.isDirectory(), force: true })
      return { deleted: true, key: normalized }
    },

    async mkdir(key) {
      guardWrite()
      const normalized = normalizeKey(key)
      const target = at(normalized)
      await fsp.mkdir(target, { recursive: true })
      await fsp.writeFile(path.join(target, KEEP_FILE), '', { flag: 'a' })
      return { created: true, key: normalized, medium: 'directory' }
    },

    async free() {
      try {
        const info = await fsp.statfs(base)
        return { freeBytes: info.bavail * info.bsize, totalBytes: info.blocks * info.bsize }
      } catch {
        return { freeBytes: null, totalBytes: null }
      }
    },

    async test() {
      const startedAt = Date.now()
      const probe = `.dsh-storage-probe-${process.pid}-${Date.now()}`
      await driver.mkdir('')
      await driver.put(probe, 'probe')
      const text = await readAll(await driver.get(probe))
      await driver.delete(probe)
      return {
        state: 'ok',
        latencyMs: Date.now() - startedAt,
        message: text.toString('utf8') === 'probe' ? 'запись, чтение и удаление прошли' : 'чтение вернуло не то, что записали',
      }
    },
  }
  return driver
}

/** Everything a driver registry needs to know about each type. */
export const DRIVERS = Object.freeze({ local: createLocalDriver, s3: createS3Driver, webdav: createWebdavDriver })

/** Map a Node fs error onto the storage vocabulary. */
export function toFilestoreError(error) {
  if (error instanceof FilestoreError) return error
  const code = error?.code
  if (code === 'ENOENT') return new FilestoreError('FILESTORE_NOT_FOUND', 'path not found', { cause: error })
  if (code === 'EACCES' || code === 'EPERM') return new FilestoreError('FILESTORE_UNAUTHORIZED', 'permission denied', { cause: error })
  if (code === 'ENOSPC') return new FilestoreError('FILESTORE_QUOTA', 'no space left', { cause: error })
  if (code === 'EISDIR') return new FilestoreError('FILESTORE_IS_DIRECTORY', 'that is a directory', { cause: error })
  return new FilestoreError('FILESTORE_ERROR', String(error?.message ?? error), { cause: error })
}

/** Read a whole stream into a buffer. */
export async function readAll(stream) {
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

/**
 * The `ctx.filestore` service. Entries come from a source function so the
 * settings document stays the single truth: a change in the panel takes effect
 * on the next call, not at the next restart.
 */
export class Filestore extends Service {
  /** @param ctx - owning cordis context. */
  constructor(ctx) {
    super(ctx, 'filestore')
    /** @type {() => object[]} */
    this.source = () => []
    /** @type {Map<string, object>} */
    this.statusCache = new Map()
    /** @type {() => object | null} */
    this.secretSource = () => null
  }

  /** Entries as the host sees them, without secrets. */
  entries() {
    return this.source().map(entry => ({ ...entry, options: { ...entry.options } }))
  }

  /** The primary entry, if one is configured. */
  primary() {
    return this.entries().find(entry => entry.role === 'primary')
  }

  /** Resolve an entry by id, or the primary one when the id is omitted. */
  entry(id) {
    const entries = this.entries()
    if (id === undefined || id === null || id === '') {
      const primary = entries.find(entry => entry.role === 'primary')
      if (primary === undefined) throw new FilestoreError('FILESTORE_NO_PRIMARY', 'no storage is marked primary')
      return primary
    }
    const found = entries.find(entry => entry.id === id)
    if (found === undefined) throw new FilestoreError('FILESTORE_NO_SUCH_STORAGE', `no storage with id ${JSON.stringify(id)}`)
    return found
  }

  /** A driver instance for an entry; throws when the entry is disabled. */
  driver(id) {
    const entry = this.entry(id)
    if (!entry.enabled) throw new FilestoreError('FILESTORE_DISABLED', `storage ${entry.id} is disabled`)
    const factory = DRIVERS[entry.type]
    if (factory === undefined) throw new FilestoreError('FILESTORE_UNSUPPORTED', `storage type ${entry.type} is not available`)
    // A secret is resolved per call, never captured: the credentials service may
    // mount after the driver is built, and a captured null never recovers.
    const resolveSecret = async () => {
      const store = this.secretSource()
      if (store === null || typeof store.resolve !== 'function') return undefined
      const resolved = await store.resolve(entry.credentialRef)
      if (resolved === undefined || resolved === null) return undefined
      // `credentials.resolve` answers `{ value, source }`, not a bare string; a
      // driver handed the object reports "no credentials" forever.
      return typeof resolved === 'string' ? resolved : resolved.value
    }
    return factory(entry, { resolveSecret })
  }

  /** Last known status; never touches the network. */
  status(id) {
    const entry = this.entry(id)
    if (!entry.enabled) return { id: entry.id, state: 'disabled', checkedAt: null, latencyMs: null, freeBytes: null, message: 'хранилище отключено' }
    const cached = this.statusCache.get(entry.id)
    if (cached !== undefined) return { ...cached }
    return { id: entry.id, state: 'unknown', checkedAt: null, latencyMs: null, freeBytes: null, message: 'ещё не проверялось' }
  }

  /** Active check: write, read and delete a probe. */
  async test(id) {
    const driver = this.driver(id)
    const startedAt = Date.now()
    try {
      const result = await driver.test()
      const free = await driver.free().catch(() => ({ freeBytes: null, totalBytes: null }))
      const status = {
        id: driver.id,
        state: 'ok',
        checkedAt: new Date().toISOString(),
        latencyMs: result.latencyMs ?? Date.now() - startedAt,
        freeBytes: free.freeBytes,
        totalBytes: free.totalBytes,
        message: result.message ?? 'ok',
      }
      this.statusCache.set(driver.id, status)
      return { ...status }
    } catch (error) {
      const mapped = toFilestoreError(error)
      const status = {
        id: driver.id,
        state: stateFor(mapped.code),
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - startedAt,
        freeBytes: null,
        totalBytes: null,
        message: mapped.message,
      }
      this.statusCache.set(driver.id, status)
      return { ...status }
    }
  }

  /** Free space of a storage; `null` when the driver cannot know. */
  async free(id) {
    const driver = this.driver(id)
    return driver.free()
  }
}

/** Map an error code onto a reported state. */
export function stateFor(code) {
  switch (code) {
    case 'FILESTORE_UNAUTHORIZED':
    case 'FILESTORE_CREDENTIAL_MISSING':
    case 'FILESTORE_CREDENTIAL_INVALID': return 'unauthorized'
    case 'FILESTORE_NOT_FOUND': return 'not-found'
    case 'FILESTORE_QUOTA': return 'quota'
    case 'FILESTORE_UNSUPPORTED': return 'error'
    default: return 'error'
  }
}

/** The prompt text the model reads; static by design, so the cache holds. */
export const PROMPT_TEXT = [
  'Remote storages are available through the storage tools.',
  '`storage_list` shows every configured storage with its id, type and state; call it before guessing where a file lives.',
  '`storage_ls` lists a directory, `storage_read` returns a file (at most 256 KiB), `storage_write` uploads a local file.',
  '`storage_mkdir` creates a directory — on a medium without directories it creates a marker object and says so.',
  'A storage marked primary is used when a call names no id. No tool takes or returns a secret.',
].join(' ')

/** Human-readable size, for tool text. */
export function humanBytes(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '?'
  const units = ['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/**
 * One line of text per tool result. `dsh-tools` calls `output.render` for every
 * result, so a tool that declares only a schema fails at call time with
 * `output.render failed: userRender is not a function` — the model never sees data.
 */
export const RENDERERS = {
  storage_list: (_args, value) => {
    if (value.storages.length === 0) return [{ type: 'text', text: 'Хранилищ нет.' }]
    const lines = value.storages.map(item => `- ${item.label} (${item.id}, ${item.type}${item.role === 'primary' ? ', основное' : ''}): ${item.state}`)
    return [{ type: 'text', text: `Хранилища:\n${lines.join('\n')}` }]
  },
  storage_ls: (args, value) => {
    const where = args.prefix === undefined || args.prefix === '' ? 'корне' : args.prefix
    const names = value.items.slice(0, 20).map(item => item.key).join('\n')
    return [{ type: 'text', text: `${value.storage}: ${value.items.length} объект(ов) в ${where}${value.truncated === true ? ' (список обрезан)' : ''}${value.items.length === 0 ? '' : `\n${names}`}` }]
  },
  storage_read: (_args, value) => [{ type: 'text', text: `${value.storage}: ${value.key}, ${humanBytes(value.size)}${value.truncated === true ? ', прочитано начало' : ''}` }],
  storage_write: (_args, value) => [{ type: 'text', text: `Записано ${value.key} в ${value.storage}, ${humanBytes(value.size)}${value.sha256 === undefined ? '' : `, sha256 ${value.sha256.slice(0, 12)}…`}` }],
  storage_mkdir: (_args, value) => [{ type: 'text', text: `Создан каталог ${value.key} в ${value.storage} (${value.medium === 'marker' ? 'маркер, у носителя нет каталогов' : 'настоящий каталог'})` }],
  storage_df: (_args, value) => [{
    type: 'text',
    text: value.freeBytes === undefined
      ? `${value.storage}: свободное место неизвестно`
      : `${value.storage}: свободно ${humanBytes(value.freeBytes)}${value.totalBytes === undefined ? '' : ` из ${humanBytes(value.totalBytes)}`}`,
  }],
  storage_delete: (_args, value) => [{ type: 'text', text: value.deleted ? `Удалено ${value.key} из ${value.storage}` : `${value.key} не найдено в ${value.storage}` }],
}

/** Create the storage tools bound to one service instance. */
export function createStorageTools(filestore) {
  const entryId = { type: 'string', description: 'Storage id; the primary storage is used when omitted.' }
  const key = { type: 'string', description: 'Key inside the storage, POSIX style, no leading slash.' }
  const listOutput = {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        storages: {
          type: 'array',
          required: true,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              label: { type: 'string', required: true },
              type: { type: 'string', required: true },
              role: { type: 'string', required: true },
              enabled: { type: 'boolean', required: true },
              state: { type: 'string', required: true },
              message: { type: 'string' },
            },
          },
        },
        primary: { type: 'string' },
      },
    },
  }
  const tools = [
    defineTool({
      name: 'storage_list',
      description: 'List the configured remote storages with id, label, type, role and last known state. Call this before reading or writing so you know which storage to use.',
      parameters: {},
      output: listOutput,
      async execute() {
        const storages = filestore.entries().map(entry => {
          const status = filestore.status(entry.id)
          return {
            id: entry.id,
            label: entry.label,
            type: entry.type,
            role: entry.role,
            enabled: entry.enabled,
            state: status.state,
            ...(status.message === undefined ? {} : { message: status.message }),
          }
        })
        const primary = storages.find(storage => storage.role === 'primary')
        return { storages, ...(primary === undefined ? {} : { primary: primary.id }) }
      },
    }),

    defineTool({
      name: 'storage_ls',
      description: 'List one directory of a storage. Returns keys, types, sizes and modification times.',
      parameters: { id: entryId, prefix: { type: 'string', description: 'Directory key; the storage root when omitted.' }, limit: { type: 'integer', description: 'Maximum entries, default 100, at most 1000.' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            storage: { type: 'string', required: true },
            items: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  key: { type: 'string', required: true },
                  type: { type: 'string', required: true },
                  size: { type: 'integer', required: true },
                  mtime: { type: 'string' },
                },
              },
            },
            truncated: { type: 'boolean' },
          },
        },
      },
      async execute(args) {
        const driver = filestore.driver(args.id)
        const limit = Math.min(Math.max(Number.isSafeInteger(args.limit) ? args.limit : 100, 1), 1000)
        const result = await driver.list(args.prefix ?? '', { limit })
        return { storage: driver.id, items: result.items, ...(result.truncated === true ? { truncated: true } : {}) }
      },
    }),

    defineTool({
      name: 'storage_read',
      description: 'Read a file from a storage. At most 256 KiB is returned; a larger file is truncated and the size is reported.',
      parameters: { id: entryId, key: { ...key, required: true } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            storage: { type: 'string', required: true },
            key: { type: 'string', required: true },
            content: { type: 'string', required: true },
            size: { type: 'integer', required: true },
            truncated: { type: 'boolean' },
          },
        },
      },
      async execute(args) {
        const driver = filestore.driver(args.id)
        const stream = await driver.get(args.key)
        const buffer = await readAll(stream)
        const slice = buffer.subarray(0, MAX_READ_BYTES)
        return {
          storage: driver.id,
          key: normalizeKey(args.key),
          content: slice.toString('utf8'),
          size: buffer.length,
          ...(buffer.length > slice.length ? { truncated: true } : {}),
        }
      },
    }),

    defineTool({
      name: 'storage_write',
      description: 'Upload a local file to a storage under a key. Use this to put something into the cloud; the file stays where it is on disk.',
      parameters: { id: entryId, key: { ...key, required: true }, path: { type: 'string', required: true, description: 'Absolute path of the local file to upload.' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            storage: { type: 'string', required: true },
            key: { type: 'string', required: true },
            size: { type: 'integer', required: true },
            sha256: { type: 'string' },
          },
        },
      },
      async execute(args) {
        const driver = filestore.driver(args.id)
        const local = path.resolve(args.path)
        const info = await fsp.stat(local).catch(() => undefined)
        if (info === undefined || !info.isFile()) throw new FilestoreError('FILESTORE_NOT_FOUND', `no such file: ${args.path}`)
        const written = await driver.putFile(args.key, local)
        return { storage: driver.id, key: written.key, size: written.size, ...(written.sha256 === undefined ? {} : { sha256: written.sha256 }) }
      },
    }),

    defineTool({
      name: 'storage_mkdir',
      description: 'Create a directory in a storage. On a medium that has no directories a marker object is created instead, and the result says which happened.',
      parameters: { id: entryId, key: { ...key, required: true } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            storage: { type: 'string', required: true },
            key: { type: 'string', required: true },
            created: { type: 'boolean', required: true },
            medium: { type: 'string', required: true },
            marker: { type: 'string' },
          },
        },
      },
      async execute(args) {
        const driver = filestore.driver(args.id)
        if (driver.capabilities.mkdir !== true) throw new FilestoreError('FILESTORE_UNSUPPORTED', `storage ${driver.id} cannot create directories`)
        const result = await driver.mkdir(args.key)
        return { storage: driver.id, key: result.key, created: result.created, medium: result.medium, ...(result.marker === undefined ? {} : { marker: result.marker }) }
      },
    }),

    defineTool({
      name: 'storage_df',
      description: 'Report free and total space of a storage when the driver can tell; both are null otherwise.',
      parameters: { id: entryId },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            storage: { type: 'string', required: true },
            freeBytes: { type: 'integer' },
            totalBytes: { type: 'integer' },
          },
        },
      },
      async execute(args) {
        const driver = filestore.driver(args.id)
        const free = await driver.free()
        return {
          storage: driver.id,
          ...(free.freeBytes === null ? {} : { freeBytes: free.freeBytes }),
          ...(free.totalBytes === null ? {} : { totalBytes: free.totalBytes }),
        }
      },
    }),

    defineTool({
      name: 'storage_delete',
      description: 'Delete one object from a storage. Deleting a directory requires recursive: true.',
      parameters: { id: entryId, key: { ...key, required: true }, recursive: { type: 'boolean', description: 'Allow deleting a non-empty directory.' } },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            storage: { type: 'string', required: true },
            key: { type: 'string', required: true },
            deleted: { type: 'boolean', required: true },
          },
        },
      },
      async execute(args) {
        const driver = filestore.driver(args.id)
        const result = await driver.delete(args.key, { recursive: args.recursive === true })
        return { storage: driver.id, key: result.key, deleted: result.deleted }
      },
    }),
  ]
  return tools.map(tool => ({ ...tool, output: { ...tool.output, render: RENDERERS[tool.name] } }))
}

/** JSON reply helper for the admin API. */
function json(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  response.end(text)
}

/** Read a JSON request body, refusing anything absurdly large. */
async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 256 * 1024) throw new FilestoreError('FILESTORE_BAD_REQUEST', 'request body is too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text === '' ? {} : JSON.parse(text)
}

/**
 * Build the admin handler mounted at {@link ROUTE_PREFIX}.
 *
 * @param settings - settings service owning the namespace.
 * @param filestore - service instance, used for `test()` and status.
 * @param credentialsOf - getter for the credentials service, which may mount late.
 * @returns an HTTP handler.
 */
export function createFilestoreHandler(settings, filestore, credentialsOf = () => null) {
  const read = () => {
    const descriptor = settings.describe().find(entry => String(entry.ns) === SETTINGS_NAMESPACE)
    const value = descriptor?.value
    return Array.isArray(value?.providers) ? value.providers.map(entry => ({ ...entry })) : []
  }
  const write = providers => settings.update(SETTINGS_NAMESPACE, { providers })
  const indexOf = (providers, raw) => {
    const index = Number(raw)
    if (!Number.isInteger(index) || index < 0 || index >= providers.length) {
      throw new FilestoreError('FILESTORE_BAD_REQUEST', `entry ${JSON.stringify(raw)} is out of range`)
    }
    return index
  }

  return async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const suffix = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) || '/' : url.pathname
      const parts = suffix.split('/').filter(part => part !== '')

      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'providers') {
        const { entries } = normalizeEntries(read())
        const store = credentialsOf()
        const providers = []
        for (const entry of entries) {
          let secretConfigured = false
          if (typeof store?.describe === 'function') {
            try {
              secretConfigured = (await store.describe(entry.credentialRef))?.configured === true
            } catch {
              secretConfigured = false
            }
          }
          providers.push({ ...entry, secretConfigured, status: filestore.status(entry.id) })
        }
        return json(response, 200, { providers, types: PROVIDER_TYPES, capabilities: CAPABILITIES })
      }

      if (request.method === 'POST' && parts.length === 1 && parts[0] === 'providers') {
        const body = await readBody(request)
        const providers = read()
        const candidate = normalizeEntry({ ...body, id: makeEntryId(providers.length) }, providers.length)
        if (candidate === undefined) return json(response, 400, { error: `unknown storage type ${JSON.stringify(body?.type)}`, code: 'FILESTORE_UNSUPPORTED' })
        if (body?.secret !== undefined && String(body.secret) !== '') {
          const store = credentialsOf()
          if (typeof store?.set === 'function') await store.set(candidate.credentialRef, String(body.secret))
        }
        const next = [...providers, { ...candidate }]
        if (body?.role === 'primary') for (const entry of next) if (entry.id !== candidate.id) entry.role = 'secondary'
        write(next)
        return json(response, 201, { provider: candidate })
      }

      if (parts[0] === 'providers' && parts.length >= 2) {
        const providers = read()
        const index = indexOf(providers, parts[1])
        const current = normalizeEntry(providers[index], index)

        if (request.method === 'PATCH') {
          const body = await readBody(request)
          if (body?.secret !== undefined && String(body.secret) !== '') {
            const store = credentialsOf()
            if (typeof store?.set === 'function') await store.set(current.credentialRef, String(body.secret))
          }
          const merged = normalizeEntry({ ...current, ...body, id: current.id }, index)
          if (merged === undefined) return json(response, 400, { error: 'unknown storage type', code: 'FILESTORE_UNSUPPORTED' })
          const next = [...providers]
          next[index] = merged
          if (body?.role === 'primary') for (const [position, entry] of next.entries()) if (position !== index) entry.role = 'secondary'
          write(next)
          return json(response, 200, { provider: merged })
        }

        if (request.method === 'DELETE') {
          if (current.role === 'primary' && providers.length > 1) {
            return json(response, 409, { error: 'назначьте другое хранилище основным перед удалением', code: 'FILESTORE_PRIMARY_IN_USE' })
          }
          write(providers.filter((_, position) => position !== index))
          return json(response, 200, { deleted: true })
        }

        if (request.method === 'POST' && parts[2] === 'test') {
          const status = await filestore.test(current.id)
          return json(response, 200, { status })
        }

        if (request.method === 'POST' && parts[2] === 'primary') {
          const next = providers.map((entry, position) => ({ ...entry, role: position === index ? 'primary' : 'secondary' }))
          write(next)
          return json(response, 200, { primary: current.id })
        }
      }

      return json(response, 404, { error: 'no such route', code: 'FILESTORE_NOT_FOUND' })
    } catch (error) {
      const mapped = toFilestoreError(error)
      return json(response, 400, { error: mapped.message, code: mapped.code })
    }
  }
}

/** Read the entry list from a `volatile()` field or a plain array. */
export function unwrapProviders(value) {
  const plain = typeof value?.get === 'function' ? value.get() : value
  return Array.isArray(plain) ? plain : []
}

/**
 * Plugin config: the fallback entry list when the settings document is empty.
 *
 * `providers` is `volatile()` on purpose: the settings service only persists
 * fields marked volatile, and without the mark every `settings.update` fails
 * with `Plugin entry "dsh-storage" has no volatile fields` — which happens
 * during boot, not at the first write, so it takes the whole host down.
 */
export const Config = z.object({
  providers: z.array(z.object({
    id: z.string(),
    type: z.string().default('local'),
    label: z.string(),
    enabled: z.boolean().default(true),
    role: z.string().default('secondary'),
    readOnly: z.boolean().default(false),
    basePath: z.string().default(''),
    options: z.object({}),
  })).default([]).volatile(),
})

/**
 * Wire the service, the settings-backed entry list, the admin route, the tools
 * and the prompt section. Every half is optional: a host without a web server
 * still gets the service and the tools.
 *
 * @param ctx - plugin context.
 * @param config - fallback configuration from the profile patch.
 */
export function apply(ctx, config = {}) {
  const filestore = new Filestore(ctx)
  const fallback = normalizeEntries(unwrapProviders(config.providers)).entries
  const shared = { settings: null, credentials: null }

  ctx.inject(['settings'], child => {
    shared.settings = child.settings
    child.effect(() => child.settings.configure({ auto: true }, ctx.fiber))
  })
  ctx.inject(['credentials'], child => {
    shared.credentials = child.credentials
    filestore.secretSource = () => shared.credentials
  })

  filestore.source = () => {
    const settings = shared.settings
    if (settings !== null && typeof settings.describe === 'function') {
      try {
        const descriptor = settings.describe().find(entry => String(entry.ns) === SETTINGS_NAMESPACE)
        const stored = descriptor?.value?.providers
        if (Array.isArray(stored)) return normalizeEntries(stored).entries
      } catch {
        // A settings service that cannot describe itself falls back to the profile.
      }
    }
    return fallback
  }

  ctx.inject(['tools'], child => {
    for (const tool of createStorageTools(filestore)) child.tools.register(tool)
  })

  ctx.inject(['systemPrompt'], child => {
    child.effect(() => {
      const hasStorage = filestore.entries().some(entry => entry.enabled)
      if (!hasStorage) return undefined
      return child.systemPrompt.section({ name: 'tool:filestore', text: PROMPT_TEXT })
    })
  })

  ctx.inject(['settings', 'webServer'], child => {
    const settings = child.settings
    const server = child.webServer
    if (typeof settings?.update !== 'function' || typeof server?.register !== 'function') return undefined
    const handler = createFilestoreHandler(settings, filestore, () => shared.credentials)
    return child.effect(() => {
      const unregister = server.register({ kind: 'prefix', path: ROUTE_PREFIX, handler })
      return () => { try { unregister?.() } catch { /* already gone */ } }
    })
  })
}

apply.Config = Config
export default apply
