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
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
// Imported at the top even though `s3.mjs` imports primitives back from here: the
// cycle is harmless because neither module touches the other at evaluation time,
// and the host half is shipped as plain ESM, never bundled.
import { createS3Driver } from './s3.mjs'
import { createWebdavDriver } from './webdav.mjs'
import { createYandexDriver } from './yadisk.mjs'
import {
  BackupWorkspace, DEFAULT_ROTATION, DEFAULT_TIMEOUT_SECONDS, atomicWriteStatus, backupTimestamp, decodeBackupKey,
  discoverSections, encodeBackupKey, listSections, makeBackupKeyRef, nextBackupId, normalizeBackupEntries, normalizeBackupEntry,
  readSectionStatus, removeWorkspace, runBackup, sanitizeBackupName, trimBackupKey,
} from './backup.mjs'
import {
  SELF_SECTION_NAME, collectCredentialRefs, credentialsDocument, finalizeSelfSection, prepareSelfSection,
  providerClientRef, resolveCredentialRefs, sanitizeConfigDocument,
} from './selfbackup.mjs'

/** Stable Loader identity. */
export const name = 'dsh-storage'

// Re-export the backup engine so participants and tests reach one surface.
export {
  BackupWorkspace, DEFAULT_ROTATION, DEFAULT_TIMEOUT_SECONDS, atomicWriteStatus, backupTimestamp, decodeBackupKey,
  encodeBackupKey, listSections, makeBackupKeyRef, nextBackupId, normalizeBackupEntries, normalizeBackupEntry,
  readSectionStatus, removeWorkspace, runBackup, sanitizeBackupName, trimBackupKey,
}

// Re-export the self-backup participant surface.
export {
  SELF_SECTION_NAME, collectCredentialRefs, credentialsDocument, finalizeSelfSection, prepareSelfSection,
  providerClientRef, resolveCredentialRefs, sanitizeConfigDocument,
}

/** Events the backup engine dispatches on the plugin context. */
export const BACKUP_EVENTS = Object.freeze({
  prepare: 'dsh-storage/prepare-backup',
  section: 'dsh-storage/backup-section',
})

/**
 * Minimal five-field cron matcher (`minute hour day-of-month month day-of-week`)
 * for the in-process backup scheduler. There is no host cron service, so the
 * plugin ticks once a minute and asks this whether a schedule fires now.
 *
 * Each field accepts a star, a star with a step, a comma list, a single value,
 * or a `a-b` range. Day-of-week is 0 (Sunday) through 6.
 */
export function cronMatches(expression, date = new Date()) {
  const fields = String(expression ?? '').trim().split(/\s+/)
  if (fields.length !== 5) return false
  const values = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()]
  const matchField = (field, value) => field
    .split(',')
    .some(part => {
      if (part === '*' || part === '') return true
      if (part.includes('/')) {
        const [base, stepText] = part.split('/')
        const step = Number(stepText)
        if (!Number.isInteger(step) || step <= 0) return false
        if (base === '*') return value % step === 0
        return matchField(base, value) && value % step === 0
      }
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number)
        return Number.isInteger(start) && Number.isInteger(end) && value >= start && value <= end
      }
      return Number(part) === value
    })
  return fields.every((field, index) => matchField(field, values[index]))
}

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
export const PROVIDER_TYPES = Object.freeze(['local', 's3', 'webdav', 'yadisk'])

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
  yadisk: Object.freeze({
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

/**
 * An id that is free right now.
 *
 * Numbering by list length reused the id of a deleted entry, and two entries then
 * shared one credential reference — one token for two storages.
 *
 * @param existing - ids already in use.
 * @returns an unused `st-` id.
 */
export function nextEntryId(existing) {
  const taken = new Set((existing ?? []).map(entry => (typeof entry === 'string' ? entry : entry?.id)))
  for (let index = 0; index < 10000; index += 1) {
    const candidate = makeEntryId(index)
    if (!taken.has(candidate)) return candidate
  }
  return `st-${Math.random().toString(36).slice(2, 8)}`
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
export const DRIVERS = Object.freeze({
  local: createLocalDriver,
  s3: createS3Driver,
  webdav: createWebdavDriver,
  yadisk: createYandexDriver,
})

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
    const resolveCredential = async name => {
      const store = this.secretSource()
      if (store === null || typeof store.resolve !== 'function') return undefined
      const resolved = await store.resolve(name)
      if (resolved === undefined || resolved === null) return undefined
      return typeof resolved === 'string' ? resolved : resolved.value
    }
    const resolveSecret = () => resolveCredential(entry.credentialRef)
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
  // The render IS what the model reads: a summary line alone would make
  // `storage_read` useless, because the bytes never reach the conversation.
  storage_read: (_args, value) => [{
    type: 'text',
    text: `${value.storage}: ${value.key}, ${humanBytes(value.size)}${value.truncated === true ? ' — прочитано только начало (файл больше 256 КиБ)' : ''}\n\n${value.content}`,
  }],
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
        const key = normalizeKey(args.key)
        const stream = await driver.get(key)
        // Read only what is returned: buffering a multi-gigabyte file to then cut
        // it to 256 KiB is how a plugin takes the host down with OOM.
        const chunks = []
        let size = 0
        for await (const chunk of stream) {
          chunks.push(chunk)
          size += chunk.length
          if (size >= MAX_READ_BYTES) {
            stream.destroy?.()
            break
          }
        }
        const buffer = Buffer.concat(chunks)
        const slice = buffer.subarray(0, MAX_READ_BYTES)
        const info = size >= MAX_READ_BYTES ? await driver.stat(key).catch(() => undefined) : undefined
        const total = info?.size ?? size
        return {
          storage: driver.id,
          key,
          content: slice.toString('utf8'),
          size: total,
          ...(total > slice.length ? { truncated: true } : {}),
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

/**
 * OAuth descriptors for the types that need a browser round trip. `secretName`
 * is the credential reference holding the application secret; the user's token
 * lands in the entry's own credential reference.
 */
export const OAUTH_PROVIDERS = {
  yadisk: {
    label: 'Яндекс.Диск',
    authorizeUrl: 'https://oauth.yandex.ru/authorize',
    tokenUrl: 'https://oauth.yandex.ru/token',
    deviceCodeUrl: 'https://oauth.yandex.ru/device/code',
    verificationUrl: 'https://oauth.yandex.ru/device',
    scope: 'cloud_api:disk.read cloud_api:disk.write',
  },
}

/**
 * Transport for the OAuth calls, replaceable so tests never reach the network.
 * A live handshake talks to the provider from the host, not from the browser.
 */
export const oauthTransport = { fetch: (...args) => fetch(...args) }

/** Started device handshakes, keyed by the state we handed to the browser. */
export const deviceStates = new Map()

/** Where unfinished handshakes are parked so a restart does not lose them. */
export function pendingHandshakesPath() {
  const home = process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
  return path.join(home, 'storage', 'device-pending.json')
}

/** Write the unfinished handshakes atomically; the file holds no secrets. */
export async function savePendingHandshakes(file, records) {
  try {
    await mkdir(path.dirname(file), { recursive: true })
    const temporary = `${file}.tmp`
    await writeFile(temporary, JSON.stringify([...records], null, 2), { mode: 0o600 })
    await rename(temporary, file)
  } catch {
    // Losing the file only costs one handshake, never a token.
  }
}

/** Read parked handshakes; an unreadable file means none. */
export async function loadPendingHandshakes(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * The handshake carried inside the state string.
 *
 * Server memory is the wrong place for it: a host restart wiped the pending
 * handshake, and the browser then reported "expired" for a code the user had
 * already confirmed. Encoding the device code into the state makes the flow
 * survive a restart, and it holds nothing secret — the device code is useless
 * without the application secret, which stays in the credential store.
 *
 * @param record - handshake fields to encode.
 * @returns an opaque state string.
 */
export function encodeDeviceState(record) {
  const payload = { e: record.entryId, c: record.clientId, d: record.deviceCode, x: record.expiresAt, t: record.tokenUrl }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

/** Read a state string back; `undefined` when it is not one of ours. */
export function decodeDeviceState(state) {
  try {
    const payload = JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8'))
    if (typeof payload?.e !== 'string' || typeof payload?.d !== 'string' || typeof payload?.c !== 'string') return undefined
    return {
      entryId: payload.e,
      clientId: payload.c,
      deviceCode: payload.d,
      expiresAt: Number(payload.x ?? 0),
      tokenUrl: typeof payload.t === 'string' ? payload.t : OAUTH_PROVIDERS.yadisk.tokenUrl,
      credentialRef: makeCredentialRef(payload.e),
    }
  } catch {
    return undefined
  }
}

/**
 * Exchange the device code for a token once.
 *
 * @param record - the stored handshake.
 * @param store - credentials service.
 * @returns `{ status: 'pending' | 'ok' | 'error' | 'expired', error? }`.
 */
export async function exchangeDeviceCode(record, store) {
  if (Date.now() > record.expiresAt) return { status: 'expired' }
  const form = new URLSearchParams({ grant_type: 'device_code', code: record.deviceCode, client_id: record.clientId })
  if (typeof store?.resolve === 'function') {
    const secret = await store.resolve(makeCredentialRef(`${record.entryId}-client`)).catch(() => undefined)
    const value = secret?.value ?? (typeof secret === 'string' ? secret : undefined)
    if (typeof value === 'string' && value !== '') form.set('client_secret', value)
  }
  const answer = await oauthTransport.fetch(record.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  })
  const body = await answer.json().catch(() => ({}))
  if (body?.error === 'authorization_pending') return { status: 'pending' }
  if (!answer.ok || typeof body.access_token !== 'string') {
    return { status: 'error', error: body?.error_description ?? body?.error ?? 'провайдер не выдал токен' }
  }
  if (typeof store?.set === 'function') await store.set(record.credentialRef, body.access_token)
  return { status: 'ok' }
}

/**
 * Pick up handshakes left over from before a restart and keep polling them.
 *
 * @param ctx - plugin context, for the log line.
 * @param store - credentials service.
 */
export async function resumePendingHandshakes(ctx, store) {
  const file = pendingHandshakesPath()
  const records = await loadPendingHandshakes(file)
  const live = []
  for (const record of records) {
    if (record?.done === true) continue
    if (Date.now() > Number(record?.expiresAt ?? 0)) continue
    const state = typeof record.state === 'string' ? record.state : encodeDeviceState(record)
    record.state = state
    deviceStates.set(state, record)
    live.push(record)
    startDevicePoller(record, store, ctx, async finished => {
      const remaining = [...deviceStates.values()].filter(item => item !== finished && item.done !== true)
      await savePendingHandshakes(file, remaining)
    })
  }
  await savePendingHandshakes(file, live)
  if (live.length > 0) deviceLog(ctx, `resumed ${live.length} pending handshake(s)`)
}

/**
 * Keep polling the provider from the host until the handshake resolves. The page
 * only asks for the current state: a browser refresh used to destroy the loop,
 * and the token was then never collected even though the user had confirmed.
 *
 * @param record - the stored handshake, mutated with `status`.
 * @param store - credentials service.
 * @param ctx - for the log line.
 */
export function startDevicePoller(record, store, ctx, onFinish = undefined) {
  const tick = async () => {
    if (record.done === true) return
    let outcome
    try {
      outcome = await exchangeDeviceCode(record, store)
    } catch (error) {
      outcome = { status: 'error', error: String(error?.message ?? error) }
    }
    record.status = outcome.status
    if (outcome.error !== undefined) record.error = outcome.error
    if (outcome.status === 'pending') {
      record.timer = setTimeout(tick, record.intervalMs)
      return
    }
    record.done = true
    deviceLog(ctx, `device/poll entry=${record.entryId} ${outcome.status}${outcome.error === undefined ? '' : `: ${outcome.error}`}`)
    if (typeof onFinish === 'function') await onFinish(record)
  }
  record.timer = setTimeout(tick, record.intervalMs)
}

/**
 * One line per OAuth step, to the process log. A handshake happens in a browser
 * tab and a host loop, so without these lines the only evidence of what went
 * wrong is a red word in the panel.
 */
function deviceLog(ctx, message) {
  const line = `[dsh-storage] ${message}`
  // stderr, so the line lands in the service journal next to everything else.
  console.error(line)
}

/** Live OAuth handshakes, keyed by state; short-lived and single-use. */
export const oauthStates = new Map()

/** How long a started handshake may sit unfinished. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

/** Drop handshakes older than the TTL. */
export function sweepOauthStates(now = Date.now()) {
  for (const [state, record] of oauthStates) if (now - record.startedAt > OAUTH_STATE_TTL_MS) oauthStates.delete(state)
}

/**
 * JSON operations behind the settings panel.
 *
 * They are plain functions on purpose: the HTTP transport is the host's business,
 * and every one of them can be exercised without a server.
 *
 * @param settings - settings service owning the namespace.
 * @param filestore - the storage service.
 * @param credentialsOf - getter for the credentials service, which may mount late.
 * @param ctx - for the device log.
 */
export function createFilestoreApi(settings, filestore, credentialsOf = () => null, ctx = undefined) {
  const readDocument = () => {
    const descriptor = settings.describe().find(entry => String(entry.ns) === SETTINGS_NAMESPACE)
    const value = descriptor?.value
    return {
      providers: Array.isArray(value?.providers) ? value.providers.map(entry => ({ ...entry })) : [],
      backups: Array.isArray(value?.backups) ? value.backups.map(entry => ({ ...entry })) : [],
    }
  }
  const read = () => readDocument().providers
  const writeDocument = document => settings.update(SETTINGS_NAMESPACE, document)
  const writeProviders = providers => writeDocument({ ...readDocument(), providers })
  const writeBackups = backups => writeDocument({ ...readDocument(), backups })
  const store = () => credentialsOf()
  const saveSecret = async (ref, value) => {
    const target = store()
    if (typeof value !== 'string' || value === '') return
    if (typeof target?.set === 'function') await target.set(ref, value)
  }

  const list = async () => {
    const { entries } = normalizeEntries(read())
    const target = store()
    const providers = []
    for (const entry of entries) {
      let secretConfigured = false
      let clientSecretConfigured = false
      if (typeof target?.describe === 'function') {
        secretConfigured = (await target.describe(entry.credentialRef).catch(() => undefined))?.configured === true
        clientSecretConfigured = (await target.describe(makeCredentialRef(`${entry.id}-client`)).catch(() => undefined))?.configured === true
      }
      providers.push({ ...entry, secretConfigured, clientSecretConfigured, status: filestore.status(entry.id) })
    }
    return { status: 200, body: { providers, types: PROVIDER_TYPES, capabilities: CAPABILITIES } }
  }

  /** Create when the body carries no id, update when it does. */
  const save = async body => {
    const providers = read()
    const existing = typeof body?.id === 'string' ? providers.findIndex(entry => entry?.id === body.id) : -1
    const base = existing >= 0 ? normalizeEntry(providers[existing], existing) : undefined
    const candidate = normalizeEntry({
      ...(base ?? {}),
      ...body,
      id: base?.id ?? (typeof body?.id === 'string' && /^st-[a-z0-9]{4,16}$/i.test(body.id) && !providers.some(entry => entry?.id === body.id) ? body.id : nextEntryId(providers)),
    }, existing >= 0 ? existing : providers.length)
    if (candidate === undefined) return { status: 400, body: { error: `unknown storage type ${JSON.stringify(body?.type)}`, code: 'FILESTORE_UNSUPPORTED' } }
    await saveSecret(candidate.credentialRef, body?.secret)
    await saveSecret(makeCredentialRef(`${candidate.id}-client`), body?.clientSecret)
    const next = existing >= 0 ? providers.map((entry, index) => (index === existing ? { ...candidate } : entry)) : [...providers, { ...candidate }]
    if (body?.role === 'primary') for (const entry of next) if (entry.id !== candidate.id) entry.role = 'secondary'
    await writeProviders(next)
    return { status: existing >= 0 ? 200 : 201, body: { provider: candidate } }
  }

  const remove = async body => {
    const providers = read()
    const index = providers.findIndex(entry => entry?.id === body?.id)
    if (index < 0) return { status: 404, body: { error: 'нет такой записи', code: 'FILESTORE_NOT_FOUND' } }
    const current = normalizeEntry(providers[index], index)
    if (current?.role === 'primary' && providers.length > 1) {
      return { status: 409, body: { error: 'назначьте другое хранилище основным перед удалением', code: 'FILESTORE_PRIMARY_IN_USE' } }
    }
    await writeProviders(providers.filter((_, position) => position !== index))
    return { status: 200, body: { deleted: true } }
  }

  const test = async body => {
    const entry = filestore.entries().find(item => item.id === body?.id)
    if (entry === undefined) return { status: 404, body: { error: 'нет такой записи', code: 'FILESTORE_NOT_FOUND' } }
    return { status: 200, body: { status: await filestore.test(entry.id) } }
  }

  const primary = async body => {
    const providers = read()
    const index = providers.findIndex(entry => entry?.id === body?.id)
    if (index < 0) return { status: 404, body: { error: 'нет такой записи', code: 'FILESTORE_NOT_FOUND' } }
    await writeProviders(providers.map((entry, position) => ({ ...entry, role: position === index ? 'primary' : 'secondary' })))
    return { status: 200, body: { primary: body.id } }
  }

  /**
   * Device handshake: ask the provider for a user code and start polling on the
   * host, so the flow survives a page reload and a restart.
   */
  const deviceStart = async body => {
    const entryId = typeof body?.id === 'string' ? body.id.trim() : ''
    const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
    const clientSecret = typeof body?.clientSecret === 'string' ? body.clientSecret.trim() : ''
    const type = typeof body?.type === 'string' ? body.type : 'yadisk'
    const descriptor = OAUTH_PROVIDERS[type]
    if (!/^st-[a-z0-9]{4,16}$/i.test(entryId)) return { status: 400, body: { error: 'нужен идентификатор записи', code: 'FILESTORE_BAD_REQUEST' } }
    if (descriptor?.deviceCodeUrl === undefined) return { status: 400, body: { error: `тип ${type} не умеет вход по коду`, code: 'FILESTORE_NO_DEVICE_FLOW' } }
    if (clientId === '') return { status: 400, body: { error: 'нужен client_id приложения', code: 'FILESTORE_NO_CLIENT_ID' } }
    if (clientSecret !== '') await saveSecret(makeCredentialRef(`${entryId}-client`), clientSecret)
    const form = new URLSearchParams({ client_id: clientId })
    if (typeof descriptor.scope === 'string') form.set('scope', descriptor.scope)
    const answer = await oauthTransport.fetch(descriptor.deviceCodeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
    })
    const answerBody = await answer.json().catch(() => ({}))
    if (!answer.ok || typeof answerBody.device_code !== 'string') {
      return { status: 400, body: { error: answerBody?.error_description ?? 'провайдер не выдал код устройства', code: 'FILESTORE_DEVICE_FLOW_FAILED' } }
    }
    const interval = Number(answerBody.interval ?? 5)
    const expiresIn = Number(answerBody.expires_in ?? 300)
    const record = {
      entryId,
      credentialRef: makeCredentialRef(entryId),
      clientId,
      tokenUrl: descriptor.tokenUrl,
      deviceCode: answerBody.device_code,
      intervalMs: Math.max(1000, interval * 1000),
      expiresAt: Date.now() + Math.max(30, expiresIn) * 1000,
      status: 'pending',
      done: false,
    }
    const state = encodeDeviceState(record)
    record.state = state
    deviceStates.set(state, record)
    const file = pendingHandshakesPath()
    await savePendingHandshakes(file, [...deviceStates.values()].filter(item => item.done !== true))
    deviceLog(ctx, `device/start entry=${entryId} userCode=${answerBody.user_code} interval=${interval}s`)
    startDevicePoller(record, store(), ctx, async finished => {
      const remaining = [...deviceStates.values()].filter(item => item !== finished && item.done !== true)
      await savePendingHandshakes(file, remaining)
    })
    return {
      status: 200,
      body: { state, userCode: answerBody.user_code, verificationUrl: answerBody.verification_url ?? descriptor.verificationUrl, interval, expiresIn },
    }
  }

  /** Report, and if needed finish, the handshake. */
  const devicePoll = async body => {
    const state = String(body?.state ?? '')
    const record = deviceStates.get(state)
    if (record === undefined) {
      const decoded = decodeDeviceState(state)
      if (decoded === undefined) return { status: 200, body: { status: 'expired' } }
      if (Date.now() > decoded.expiresAt) return { status: 200, body: { status: 'expired' } }
      let outcome
      try {
        outcome = await exchangeDeviceCode(decoded, store())
      } catch (error) {
        outcome = { status: 'error', error: String(error?.message ?? error) }
      }
      return { status: 200, body: { status: outcome.status, ...(outcome.error === undefined ? {} : { error: outcome.error }) } }
    }
    if (record.done === true && record.status === 'ok') deviceStates.delete(state)
    return { status: 200, body: { status: record.done === true ? record.status : 'pending', ...(record.error === undefined ? {} : { error: record.error }) } }
  }

  const resolveSecretValue = async ref => {
    const target = store()
    if (target === null || typeof target.resolve !== 'function') return undefined
    const resolved = await target.resolve(ref).catch(() => undefined)
    if (resolved === undefined || resolved === null) return undefined
    return typeof resolved === 'string' ? resolved : resolved.value
  }

  /** The fields of a normalized backup that belong in the settings document. */
  const persistedBackup = entry => ({
    id: entry.id,
    name: entry.name,
    providerId: entry.providerId,
    directory: entry.directory,
    rotation: entry.rotation,
    timeoutSeconds: entry.timeoutSeconds,
    ignore: [...entry.ignore],
    include: [...entry.include],
    sections: [...entry.sections],
    credentialRef: entry.credentialRef,
    schedule: entry.schedule,
  })

  const listBackups = async () => {
    const { providers, backups } = readDocument()
    const providerIds = normalizeEntries(providers).entries.map(entry => entry.id)
    const entries = normalizeBackupEntries(backups, providerIds)
    const target = store()
    const out = []
    for (const entry of entries) {
      let keyConfigured = false
      if (typeof target?.describe === 'function') {
        keyConfigured = (await target.describe(entry.credentialRef).catch(() => undefined))?.configured === true
      }
      out.push({ ...entry, keyConfigured })
    }
    const providersForSelect = normalizeEntries(providers).entries.map(entry => ({ id: entry.id, label: entry.label, type: entry.type }))
    return { status: 200, body: { backups: out, providers: providersForSelect } }
  }

  const saveBackup = async body => {
    const { providers, backups } = readDocument()
    const providerIds = normalizeEntries(providers).entries.map(entry => entry.id)
    const existing = typeof body?.id === 'string' ? backups.findIndex(entry => entry?.id === body.id) : -1
    const base = existing >= 0 ? normalizeBackupEntry(backups[existing], existing, providerIds) : undefined
    const candidate = normalizeBackupEntry({
      ...(base ?? {}),
      ...body,
      id: base?.id ?? (typeof body?.id === 'string' && /^bk-[a-z0-9]{4,16}$/i.test(body.id) && !backups.some(entry => entry?.id === body.id) ? body.id : nextBackupId(backups)),
    }, existing >= 0 ? existing : backups.length, providerIds)
    if (candidate === undefined) return { status: 400, body: { error: 'нужны имя и провайдер', code: 'BACKUP_BAD_REQUEST' } }
    if (candidate.known !== true) return { status: 400, body: { error: `нет хранилища ${JSON.stringify(candidate.providerId)}`, code: 'BACKUP_UNKNOWN_PROVIDER' } }
    // The key is trimmed (outer whitespace only), encoded as UTF-8 bytes -> base64,
    // and stored in credentials; an empty key means "keep the stored one".
    if (typeof body?.key === 'string') {
      const trimmed = trimBackupKey(body.key)
      if (trimmed !== '') await saveSecret(candidate.credentialRef, encodeBackupKey(trimmed))
    }
    const next = existing >= 0
      ? backups.map((entry, index) => (index === existing ? persistedBackup(candidate) : entry))
      : [...backups, persistedBackup(candidate)]
    await writeBackups(next)
    return { status: existing >= 0 ? 200 : 201, body: { backup: { ...candidate } } }
  }

  const removeBackup = async body => {
    const { backups } = readDocument()
    const index = backups.findIndex(entry => entry?.id === body?.id)
    if (index < 0) return { status: 404, body: { error: 'нет такой записи', code: 'FILESTORE_NOT_FOUND' } }
    await writeBackups(backups.filter((_, position) => position !== index))
    return { status: 200, body: { deleted: true } }
  }

  const runBackupNow = async body => {
    const { providers, backups } = readDocument()
    const providerIds = normalizeEntries(providers).entries.map(entry => entry.id)
    const entries = normalizeBackupEntries(backups, providerIds)
    const entry = entries.find(item => item.id === body?.id)
    if (entry === undefined) return { status: 404, body: { error: 'нет такой записи', code: 'FILESTORE_NOT_FOUND' } }
    const result = await runBackup(ctx, entry, filestore, resolveSecretValue, {
      persistSections: discovered => persistBackupSections(entry.id, discovered),
    })
    return { status: 200, body: result }
  }

  /** Write the discovered section list back into one backup entry. */
  const persistBackupSections = async (id, sections) => {
    const { backups } = readDocument()
    const next = backups.map(entry => (entry?.id === id ? { ...entry, sections: [...sections] } : entry))
    await writeBackups(next)
  }

  /** Prepare-only discovery: sync prepare, record sections, workspace removed. */
  const refreshSections = async body => {
    const { providers, backups } = readDocument()
    const providerIds = normalizeEntries(providers).entries.map(entry => entry.id)
    const entries = normalizeBackupEntries(backups, providerIds)
    const entry = entries.find(item => item.id === body?.id)
    if (entry === undefined) return { status: 404, body: { error: 'нет такой записи', code: 'FILESTORE_NOT_FOUND' } }
    const discovered = await discoverSections(ctx, {})
    await persistBackupSections(entry.id, discovered)
    return { status: 200, body: { sections: discovered } }
  }

  return { list, save, remove, test, primary, deviceStart, devicePoll, listBackups, saveBackup, removeBackup, runBackupNow, refreshSections }
}

/**
 * Exact routes under `/api`, which the host admits only for an authenticated owner
 * — the same gate `/api/settings` sits behind.
 *
 * @param connection - `ctx.connection`.
 * @param api - operations from {@link createFilestoreApi}.
 * @returns the disposers of every registered route.
 */
export function registerFilestoreRoutes(connection, api) {
  if (typeof connection?.fetch?.register !== 'function') return []
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })
  const readJson = async request => {
    const text = await request.text().catch(() => '')
    return text.trim() === '' ? {} : JSON.parse(text)
  }
  const route = (path, methods, run) => connection.fetch.register({
    path,
    methods,
    requestBody: 'buffered',
    fetch: async request => {
      try {
        const body = methods.includes('POST') && request.method === 'POST' ? await readJson(request) : {}
        const result = await run(body)
        return json(result.status, result.body)
      } catch (error) {
        return json(400, { error: String(error?.message ?? error), code: error?.code ?? 'FILESTORE_ERROR' })
      }
    },
  })
  return [
    route('/api/filestore/providers', ['GET'], () => api.list()),
    route('/api/filestore/providers/save', ['POST'], body => api.save(body)),
    route('/api/filestore/providers/delete', ['POST'], body => api.remove(body)),
    route('/api/filestore/providers/test', ['POST'], body => api.test(body)),
    route('/api/filestore/providers/primary', ['POST'], body => api.primary(body)),
    route('/api/filestore/device/start', ['POST'], body => api.deviceStart(body)),
    route('/api/filestore/device/poll', ['POST'], body => api.devicePoll(body)),
    route('/api/filestore/backups', ['GET'], () => api.listBackups()),
    route('/api/filestore/backups/save', ['POST'], body => api.saveBackup(body)),
    route('/api/filestore/backups/delete', ['POST'], body => api.removeBackup(body)),
    route('/api/filestore/backups/run', ['POST'], body => api.runBackupNow(body)),
    route('/api/filestore/backups/sections', ['POST'], body => api.refreshSections(body)),
  ]
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
export function createFilestoreHandler(settings, filestore, credentialsOf = () => null, ctx = undefined, guard = undefined) {
  const readDocument = () => {
    const descriptor = settings.describe().find(entry => String(entry.ns) === SETTINGS_NAMESPACE)
    const value = descriptor?.value
    return {
      providers: Array.isArray(value?.providers) ? value.providers.map(entry => ({ ...entry })) : [],
      backups: Array.isArray(value?.backups) ? value.backups.map(entry => ({ ...entry })) : [],
    }
  }
  const read = () => readDocument().providers
  // Awaited by every caller: a rejected settings update is an unhandled rejection,
  // and an unhandled rejection ends the process.
  const writeDocument = document => settings.update(SETTINGS_NAMESPACE, document)
  const writeProviders = providers => writeDocument({ ...readDocument(), providers })
  const writeBackups = backups => writeDocument({ ...readDocument(), backups })
  const indexOf = (providers, raw) => {
    const index = Number(raw)
    if (!Number.isInteger(index) || index < 0 || index >= providers.length) {
      throw new FilestoreError('FILESTORE_BAD_REQUEST', `entry ${JSON.stringify(raw)} is out of range`)
    }
    return index
  }

  return async (request, response) => {
    try {
      // The host's own API is token-guarded; a plugin prefix is not, so ask the
      // connection service the same question it asks about /api/*: is this a
      // browser with a signed session, or an API client with a bearer token?
      const rejection = typeof guard === 'function' ? guard(request) : undefined
      if (rejection !== undefined) {
        return json(response, rejection, { error: 'нужна авторизация DSH', code: 'FILESTORE_UNAUTHORIZED' })
      }
      const url = new URL(request.url ?? '/', 'http://localhost')
      const suffix = url.pathname.startsWith(ROUTE_PREFIX) ? url.pathname.slice(ROUTE_PREFIX.length) || '/' : url.pathname
      const parts = suffix.split('/').filter(part => part !== '')

      if (request.method === 'GET' && parts.length === 1 && parts[0] === 'providers') {
        const { entries } = normalizeEntries(read())
        const store = credentialsOf()
        const providers = []
        for (const entry of entries) {
          let secretConfigured = false
          let clientSecretConfigured = false
          if (typeof store?.describe === 'function') {
            try {
              secretConfigured = (await store.describe(entry.credentialRef))?.configured === true
            } catch {
              secretConfigured = false
            }
            try {
              clientSecretConfigured = (await store.describe(makeCredentialRef(`${entry.id}-client`)))?.configured === true
            } catch {
              clientSecretConfigured = false
            }
          }
          // Two different secrets: the user token and the application secret. A
          // single "secret is set" line hid which one was missing.
          providers.push({ ...entry, secretConfigured, clientSecretConfigured, status: filestore.status(entry.id) })
        }
        return json(response, 200, { providers, types: PROVIDER_TYPES, capabilities: CAPABILITIES })
      }

      if (request.method === 'POST' && parts.length === 1 && parts[0] === 'providers') {
        const body = await readBody(request)
        const providers = read()
        // The panel allocates an id when the form opens, so a credential taken by
        // the device handshake before saving already points at the right entry.
        const provided = typeof body?.id === 'string' && /^st-[a-z0-9]{4,16}$/i.test(body.id) && !providers.some(entry => entry?.id === body.id)
          ? body.id
          : undefined
        const candidate = normalizeEntry({ ...body, id: provided ?? nextEntryId(providers) }, providers.length)
        if (candidate === undefined) return json(response, 400, { error: `unknown storage type ${JSON.stringify(body?.type)}`, code: 'FILESTORE_UNSUPPORTED' })
        if (body?.secret !== undefined && String(body.secret) !== '') {
          const store = credentialsOf()
          if (typeof store?.set === 'function') await store.set(candidate.credentialRef, String(body.secret))
        }
        // OAuth applications also need their own secret, kept separately from the
        // token: one belongs to the app, the other to the user.
        if (body?.clientSecret !== undefined && String(body.clientSecret) !== '') {
          const store = credentialsOf()
          if (typeof store?.set === 'function') await store.set(makeCredentialRef(`${candidate.id}-client`), String(body.clientSecret))
        }
        const next = [...providers, { ...candidate }]
        if (body?.role === 'primary') for (const entry of next) if (entry.id !== candidate.id) entry.role = 'secondary'
        await writeProviders(next)
        return json(response, 201, { provider: candidate })
      }

      // Device handshake that does not need a saved entry yet: the panel sends the
      // entry id it is about to save and the application id typed into the form.
      if (request.method === 'POST' && parts[0] === 'auth' && parts[1] === 'device' && parts[2] === 'start') {
        const body = await readBody(request)
        const entryId = typeof body?.id === 'string' ? body.id.trim() : ''
        const clientId = typeof body?.clientId === 'string' ? body.clientId.trim() : ''
        const clientSecret = typeof body?.clientSecret === 'string' ? body.clientSecret.trim() : ''
        const type = typeof body?.type === 'string' ? body.type : 'yadisk'
        const descriptor = OAUTH_PROVIDERS[type]
        if (!/^st-[a-z0-9]{4,16}$/i.test(entryId)) return json(response, 400, { error: 'нужен идентификатор записи', code: 'FILESTORE_BAD_REQUEST' })
        if (descriptor?.deviceCodeUrl === undefined) return json(response, 400, { error: `тип ${type} не умеет вход по коду`, code: 'FILESTORE_NO_DEVICE_FLOW' })
        if (clientId === '') return json(response, 400, { error: 'нужен client_id приложения', code: 'FILESTORE_NO_CLIENT_ID' })
        // The form may hold a secret that was never saved: an unsaved entry has no
        // place to keep it yet, and the exchange would then answer "Wrong client
        // secret". Store it now, under the id the save will use.
        if (clientSecret !== '') {
          const store = credentialsOf()
          if (typeof store?.set === 'function') await store.set(makeCredentialRef(`${entryId}-client`), clientSecret)
        }
        const form = new URLSearchParams({ client_id: clientId })
        if (typeof descriptor.scope === 'string') form.set('scope', descriptor.scope)
        const answer = await oauthTransport.fetch(descriptor.deviceCodeUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form,
        })
        const answerBody = await answer.json().catch(() => ({}))
        if (!answer.ok || typeof answerBody.device_code !== 'string') {
          return json(response, 400, {
            error: answerBody?.error_description ?? 'провайдер не выдал код устройства',
            code: 'FILESTORE_DEVICE_FLOW_FAILED',
          })
        }
        const interval = Number(answerBody.interval ?? 5)
        const expiresIn = Number(answerBody.expires_in ?? 300)
        const record = {
          entryId,
          credentialRef: makeCredentialRef(entryId),
          clientId,
          tokenUrl: descriptor.tokenUrl,
          deviceCode: answerBody.device_code,
          intervalMs: Math.max(1000, interval * 1000),
          expiresAt: Date.now() + Math.max(30, expiresIn) * 1000,
          status: 'pending',
          done: false,
        }
        const state = encodeDeviceState(record)
        deviceStates.set(state, record)
        const file = pendingHandshakesPath()
        record.state = state
        await savePendingHandshakes(file, [...deviceStates.values()].filter(item => item.done !== true))
        deviceLog(ctx, `device/start entry=${entryId} userCode=${answerBody.user_code} interval=${interval}s`)
        startDevicePoller(record, credentialsOf(), ctx, async finished => {
          const remaining = [...deviceStates.values()].filter(item => item !== finished && item.done !== true)
          await savePendingHandshakes(file, remaining)
        })
        return json(response, 200, {
          state,
          userCode: answerBody.user_code,
          verificationUrl: answerBody.verification_url ?? descriptor.verificationUrl,
          interval,
          expiresIn,
        })
      }

      // The host owns the polling loop; this route only reports where it stands, so
      // a page reload no longer throws away a confirmed handshake.
      if (request.method === 'POST' && parts[0] === 'auth' && parts[1] === 'device' && parts[2] === 'poll') {
        const body = await readBody(request)
        const state = String(body?.state ?? '')
        const record = deviceStates.get(state)
        if (record === undefined) {
          // No live record: the host restarted. The state still carries everything
          // needed, so finish the exchange here instead of calling it expired.
          const decoded = decodeDeviceState(state)
          if (decoded === undefined) return json(response, 200, { status: 'expired' })
          if (Date.now() > decoded.expiresAt) return json(response, 200, { status: 'expired' })
          let outcome
          try {
            outcome = await exchangeDeviceCode(decoded, credentialsOf())
          } catch (error) {
            outcome = { status: 'error', error: String(error?.message ?? error) }
          }
          if (outcome.status !== 'pending') deviceLog(ctx, `device/poll(stateless) entry=${decoded.entryId} ${outcome.status}`)
          return json(response, 200, { status: outcome.status, ...(outcome.error === undefined ? {} : { error: outcome.error }) })
        }
        if (record.done === true && record.status === 'ok') deviceStates.delete(state)
        return json(response, 200, {
          status: record.done === true ? record.status : 'pending',
          ...(record.error === undefined ? {} : { error: record.error }),
        })
      }

      if (parts[0] === 'providers' && parts.length >= 2) {
        const providers = read()
        const index = indexOf(providers, parts[1])
        const current = normalizeEntry(providers[index], index)

        // OAuth handshake, step one: hand the browser a URL and remember the state.
        if (request.method === 'POST' && parts[2] === 'auth' && parts[3] === 'start') {
          const descriptor = OAUTH_PROVIDERS[current.type]
          if (descriptor === undefined) return json(response, 400, { error: `тип ${current.type} не использует OAuth`, code: 'FILESTORE_NO_OAUTH' })
          const clientId = current.options?.clientId
          if (typeof clientId !== 'string' || clientId.trim() === '') {
            return json(response, 400, { error: 'нужен client_id приложения, зарегистрированного у провайдера', code: 'FILESTORE_NO_CLIENT_ID' })
          }
          sweepOauthStates()
          const state = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
          const host = String(request.headers?.host ?? 'localhost')
          const proto = String(request.headers?.['x-forwarded-proto'] ?? 'https')
          const redirectUri = current.options?.redirectUri ?? `${proto}://${host}${ROUTE_PREFIX}/providers/${index}/auth/callback`
          oauthStates.set(state, { index, entryId: current.id, redirectUri, startedAt: Date.now() })
          const url = new URL(descriptor.authorizeUrl)
          url.searchParams.set('response_type', 'code')
          url.searchParams.set('client_id', clientId)
          url.searchParams.set('redirect_uri', redirectUri)
          url.searchParams.set('state', state)
          if (typeof descriptor.scope === 'string') url.searchParams.set('scope', descriptor.scope)
          return json(response, 200, { url: url.toString(), redirectUri })
        }

        // Step two: the provider sends the browser back here with a code.
        if (request.method === 'GET' && parts[2] === 'auth' && parts[3] === 'callback') {
          const state = url.searchParams.get('state') ?? ''
          const code = url.searchParams.get('code') ?? ''
          const record = oauthStates.get(state)
          if (record === undefined) return json(response, 400, { error: 'неизвестный или просроченный state', code: 'FILESTORE_BAD_STATE' })
          oauthStates.delete(state)
          const descriptor = OAUTH_PROVIDERS[current.type]
          const clientId = current.options?.clientId
          const store = credentialsOf()
          const clientSecret = typeof store?.resolve === 'function'
            ? (await store.resolve(makeCredentialRef(`${current.id}-client`)).catch(() => undefined))?.value
            : undefined
          if (typeof clientSecret !== 'string' || clientSecret === '') {
            return json(response, 400, { error: 'нет client_secret в credentials', code: 'FILESTORE_NO_CLIENT_SECRET' })
          }
          const form = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: record.redirectUri })
          const tokenResponse = await fetch(descriptor.tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form })
          const tokenBody = await tokenResponse.json().catch(() => ({}))
          if (!tokenResponse.ok || typeof tokenBody.access_token !== 'string') {
            return json(response, 400, { error: tokenBody?.error_description ?? 'провайдер не выдал токен', code: 'FILESTORE_OAUTH_FAILED' })
          }
          if (typeof store?.set === 'function') await store.set(current.credentialRef, tokenBody.access_token)
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          response.end('<!doctype html><meta charset="utf-8"><title>Готово</title><p>Хранилище подключено. Закройте окно и вернитесь в настройки.</p>')
          return undefined
        }

        // Device flow, step one: ask the provider for a short user code.
        if (request.method === 'POST' && parts[2] === 'auth' && parts[3] === 'device' && parts[4] === 'start') {
          const descriptor = OAUTH_PROVIDERS[current.type]
          if (descriptor?.deviceCodeUrl === undefined) return json(response, 400, { error: `тип ${current.type} не умеет вход по коду`, code: 'FILESTORE_NO_DEVICE_FLOW' })
          const clientId = current.options?.clientId
          if (typeof clientId !== 'string' || clientId.trim() === '') {
            return json(response, 400, { error: 'нужен client_id приложения', code: 'FILESTORE_NO_CLIENT_ID' })
          }
          const form = new URLSearchParams({ client_id: clientId.trim() })
          if (typeof descriptor.scope === 'string') form.set('scope', descriptor.scope)
          const answer = await oauthTransport.fetch(descriptor.deviceCodeUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: form,
          })
          const body = await answer.json().catch(() => ({}))
          if (!answer.ok || typeof body.device_code !== 'string') {
            return json(response, 400, {
              error: body?.error_description ?? 'провайдер не выдал код устройства',
              code: 'FILESTORE_DEVICE_FLOW_FAILED',
            })
          }
          const state = `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
          const interval = Number(body.interval ?? 5)
          const expiresIn = Number(body.expires_in ?? 300)
          deviceStates.set(state, {
            entryId: current.id,
            credentialRef: current.credentialRef,
            clientId: clientId.trim(),
            tokenUrl: descriptor.tokenUrl,
            deviceCode: body.device_code,
            intervalMs: Math.max(1000, interval * 1000),
            expiresAt: Date.now() + Math.max(30, expiresIn) * 1000,
            // Counted from the handshake itself: the first poll must also respect
            // the provider's interval, or it answers with a rate-limit error.
            lastPollAt: Date.now(),
          })
          return json(response, 200, {
            state,
            userCode: body.user_code,
            verificationUrl: body.verification_url ?? descriptor.verificationUrl,
            interval,
            expiresIn,
          })
        }

        // Device flow, step two: the browser asks us whether the user confirmed yet.
        if (request.method === 'POST' && parts[2] === 'auth' && parts[3] === 'device' && parts[4] === 'poll') {
          const body = await readBody(request)
          const state = String(body?.state ?? '')
          const record = deviceStates.get(state)
          if (record === undefined) return json(response, 200, { status: 'expired' })
          if (Date.now() > record.expiresAt) {
            deviceStates.delete(state)
            return json(response, 200, { status: 'expired' })
          }
          // Never poll the provider faster than it asked us to.
          if (Date.now() - record.lastPollAt < record.intervalMs) return json(response, 200, { status: 'pending' })
          record.lastPollAt = Date.now()
          const form = new URLSearchParams({ grant_type: 'device_code', code: record.deviceCode, client_id: record.clientId })
          const store = credentialsOf()
          if (typeof store?.resolve === 'function') {
            const secret = await store.resolve(makeCredentialRef(`${record.entryId}-client`)).catch(() => undefined)
            const value = secret?.value ?? (typeof secret === 'string' ? secret : undefined)
            if (typeof value === 'string' && value !== '') form.set('client_secret', value)
          }
          const answer = await oauthTransport.fetch(record.tokenUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: form,
          })
          const answerBody = await answer.json().catch(() => ({}))
          if (answerBody?.error === 'authorization_pending') return json(response, 200, { status: 'pending' })
          if (!answer.ok || typeof answerBody.access_token !== 'string') {
            deviceStates.delete(state)
            return json(response, 200, {
              status: 'error',
              error: answerBody?.error_description ?? answerBody?.error ?? 'провайдер не выдал токен',
            })
          }
          if (typeof store?.set === 'function') await store.set(record.credentialRef, answerBody.access_token)
          deviceStates.delete(state)
          return json(response, 200, { status: 'ok' })
        }

        // Manual path: a token pasted by hand, for anyone who cannot run the redirect.
        if (request.method === 'POST' && parts[2] === 'auth' && parts[3] === 'code') {
          const body = await readBody(request)
          const value = String(body?.token ?? '').trim()
          if (value === '') return json(response, 400, { error: 'пустой токен', code: 'FILESTORE_BAD_REQUEST' })
          const store = credentialsOf()
          if (typeof store?.set !== 'function') return json(response, 400, { error: 'сервис секретов недоступен', code: 'FILESTORE_NO_CREDENTIALS' })
          await store.set(current.credentialRef, value)
          return json(response, 200, { tokenConfigured: true })
        }

        if (request.method === 'PATCH') {
          const body = await readBody(request)
          if (body?.secret !== undefined && String(body.secret) !== '') {
            const store = credentialsOf()
            if (typeof store?.set === 'function') await store.set(current.credentialRef, String(body.secret))
          }
          if (body?.clientSecret !== undefined && String(body.clientSecret) !== '') {
            const store = credentialsOf()
            if (typeof store?.set === 'function') await store.set(makeCredentialRef(`${current.id}-client`), String(body.clientSecret))
          }
          const merged = normalizeEntry({ ...current, ...body, id: current.id }, index)
          if (merged === undefined) return json(response, 400, { error: 'unknown storage type', code: 'FILESTORE_UNSUPPORTED' })
          const next = [...providers]
          next[index] = merged
          if (body?.role === 'primary') for (const [position, entry] of next.entries()) if (position !== index) entry.role = 'secondary'
          await writeProviders(next)
          return json(response, 200, { provider: merged })
        }

        if (request.method === 'DELETE') {
          if (current.role === 'primary' && providers.length > 1) {
            return json(response, 409, { error: 'назначьте другое хранилище основным перед удалением', code: 'FILESTORE_PRIMARY_IN_USE' })
          }
          await writeProviders(providers.filter((_, position) => position !== index))
          return json(response, 200, { deleted: true })
        }

        if (request.method === 'POST' && parts[2] === 'test') {
          const status = await filestore.test(current.id)
          return json(response, 200, { status })
        }

        if (request.method === 'POST' && parts[2] === 'primary') {
          const next = providers.map((entry, position) => ({ ...entry, role: position === index ? 'primary' : 'secondary' }))
          await writeProviders(next)
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
  backups: z.array(z.object({
    id: z.string(),
    name: z.string(),
    providerId: z.string(),
    directory: z.string().default(''),
    rotation: z.number().default(DEFAULT_ROTATION),
    timeoutSeconds: z.number().default(DEFAULT_TIMEOUT_SECONDS),
    ignore: z.array(z.string()).default([]),
    include: z.array(z.string()).default([]),
    sections: z.array(z.string()).default([]),
    credentialRef: z.string().default(''),
    schedule: z.string().default(''),
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
    // A restart in the middle of a handshake used to lose it; pick it back up.
    child.effect(() => {
      const timer = setTimeout(() => {
        resumePendingHandshakes(child, shared.credentials).catch(() => {})
      }, 0)
      return () => clearTimeout(timer)
    }, 'dsh-storage: resume device handshakes')
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

  const readBackups = () => {
    const settings = shared.settings
    if (settings === null || typeof settings.describe !== 'function') return []
    try {
      const descriptor = settings.describe().find(entry => String(entry.ns) === SETTINGS_NAMESPACE)
      const stored = descriptor?.value?.backups
      if (!Array.isArray(stored)) return []
      const providerIds = filestore.entries().map(entry => entry.id)
      return normalizeBackupEntries(stored, providerIds)
    } catch {
      return []
    }
  }

  const resolveBackupSecret = async ref => {
    const store = shared.credentials
    if (store === null || typeof store.resolve !== 'function') return undefined
    const resolved = await store.resolve(ref).catch(() => undefined)
    if (resolved === undefined || resolved === null) return undefined
    return typeof resolved === 'string' ? resolved : resolved.value
  }

  /** Persist a freshly discovered section list back into one backup entry. */
  const persistBackupSections = async (id, sections) => {
    const settings = shared.settings
    if (settings === null || typeof settings.update !== 'function') return
    const descriptor = settings.describe().find(entry => String(entry.ns) === SETTINGS_NAMESPACE)
    const stored = Array.isArray(descriptor?.value?.backups) ? descriptor.value.backups : []
    const next = stored.map(entry => (entry?.id === id ? { ...entry, sections: [...sections] } : entry))
    await settings.update(SETTINGS_NAMESPACE, { ...(descriptor?.value ?? {}), backups: next }).catch(() => {})
  }

  // Self-backup: dsh-storage participates in its own backup. The prepare event
  // is synchronous (config + RESTORE.md written with sync fs); the section event
  // is asynchronous, so the owned credentials are resolved there and the status
  // is marked ok last.
  ctx.on(BACKUP_EVENTS.prepare, workspace => {
    prepareSelfSection(workspace, { providers: filestore.entries(), backups: readBackups() })
  })
  ctx.on(BACKUP_EVENTS.section, payload => {
    if (payload?.section !== SELF_SECTION_NAME) return undefined
    return finalizeSelfSection(payload.directory, {
      store: shared.credentials,
      providers: filestore.entries(),
      backups: readBackups(),
    })
  })

  // Cron scheduler. There is no host cron service, so the plugin ticks once a
  // minute and runs any backup whose `schedule` matches the current minute.
  // An error is logged and wakes the model through the optional seam; a success
  // returns a clean result and nothing is woken.
  ctx.inject(['settings', 'credentials'], child => {
    const lastRunAt = new Map()
    const tick = async () => {
      for (const entry of readBackups()) {
        if (entry.schedule === '' || !cronMatches(entry.schedule)) continue
        const minute = Math.floor(Date.now() / 60000)
        if ((lastRunAt.get(entry.id) ?? -1) === minute) continue
        lastRunAt.set(entry.id, minute)
        const result = await runBackup(child, entry, filestore, resolveBackupSecret, {
          persistSections: discovered => persistBackupSections(entry.id, discovered),
        })
        if (result.code === 'ok') {
          child.logger?.info?.(`[dsh-storage] cron backup ${entry.name}: ${result.message}`)
        } else {
          const line = `[dsh-storage] cron backup ${entry.name} failed: ${result.code} ${result.message}`
          child.logger?.error?.(line)
          console.error(line)
          // Wake the model only on error. The host exposes no public wake
          // service to background plugins, so this is a seam: wire it in the
          // profile config to reach the agent inbox; the default is log-only.
          if (typeof config.notifyBackupError === 'function') {
            try { config.notifyBackupError(result) } catch { /* a notification must not take the tick down */ }
          }
        }
      }
    }
    return child.effect(() => {
      const timer = setInterval(() => { tick().catch(() => {}) }, 60 * 1000)
      timer.unref?.()
      return () => clearInterval(timer)
    }, 'dsh-storage: backup scheduler')
  })

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

  // The admin API rides the host's own /api channel, which admits only an
  // authenticated owner. A bare prefix registered on the web server would answer
  // the whole internet, and that is not a decision a storage plugin gets to make.
  ctx.inject(['settings', 'connection'], child => {
    const settings = child.settings
    if (typeof settings?.update !== 'function') return undefined
    const api = createFilestoreApi(settings, filestore, () => shared.credentials, child)
    return child.effect(() => {
      const disposers = registerFilestoreRoutes(child.connection, api)
      return () => { for (const dispose of disposers) { try { dispose?.() } catch { /* already gone */ } } }
    })
  })
}

apply.Config = Config
export default apply
