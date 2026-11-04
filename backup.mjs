/**
 * Backups on top of the existing dsh-storage filestore.
 *
 * A backup is NOT a separate plugin or package: it extends `@dr-co/dsh-storage`
 * in the same settings namespace, the same admin API surface and the same
 * client panel. This module holds the engine only — event orchestration,
 * section lifecycle, tar streaming, OpenPGP encryption and rotation — so it can
 * be tested without a live cordis context.
 *
 * Event contract (see {@link runBackup}):
 *   - `dsh-storage/prepare-backup`  sync; passes a {@link BackupWorkspace}.
 *     Participants create any number of sections synchronously.
 *   - `dsh-storage/backup-section`  async (`ctx.parallel`); passes
 *     `{ directory, section, signal }`. The host fires the event and polls
 *     `$section/status.json` (at most once per second) until it reaches
 *     `ok` / `error` / `child-failed`. The receiver MUST rewrite status.json
 *     atomically (temp file + rename, which replaces the inode); a missing
 *     rewrite is a contract error. A rejected handler is captured, never lost.
 *
 * A section is one direct subdirectory of the workspace. It may carry a
 * `RESTORE.md` and must support a `status.json` of the shape
 * `{ status, updatedAt, pids, message? }`, where `pids` are child process ids
 * the receiver owns and the host kills on failure.
 *
 * @module @dr-co/dsh-storage/backup
 */
import { createReadStream, createWriteStream, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createZstdCompress } from 'node:zlib'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as openpgp from 'openpgp'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

/** Yield between status.json polls, at most once per second. */
const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Status values a section receiver may report. */
export const SECTION_STATUS = Object.freeze(['ok', 'running', 'error', 'child-failed'])

/** Section outcomes the host classifies. */
export const SECTION_OUTCOMES = Object.freeze(['ok', 'ignored', 'timeout', 'no-status-update', 'error-status', 'child-failure'])

/** Default per-section timeout, in seconds. */
export const DEFAULT_TIMEOUT_SECONDS = 5 * 60

/** Minimum interval between status.json polls; never busy-loop. */
export const POLL_INTERVAL_MS = 1000

/** Default number of kept archive pairs. */
export const DEFAULT_ROTATION = 10

/** Largest rotation count the admin API will accept. */
export const MAX_ROTATION = 1000

/** Largest per-section timeout the admin API will accept, in seconds. */
export const MAX_TIMEOUT_SECONDS = 24 * 60 * 60

/**
 * Error carrying a stable backup code, distinct from the filestore vocabulary.
 */
export class BackupError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'BackupError'
    this.code = code
  }
}

/** Map a section outcome onto the result code of a failed backup. */
export function codeForOutcome(outcome) {
  switch (outcome) {
    case 'timeout': return 'BACKUP_TIMEOUT'
    case 'no-status-update': return 'BACKUP_NO_STATUS_UPDATE'
    case 'child-failure': return 'BACKUP_CHILD_FAILURE'
    case 'error-status': return 'BACKUP_ERROR_STATUS'
    default: return 'BACKUP_FAILED'
  }
}

/** The DSH tree root: workspace and staging dirs live here, never in /tmp. */
export function dshHome() {
  return process.env.DSH_HOME ?? path.join(homedir(), '.dsh')
}

/** Directory under which backup workspaces are created. */
export function backupWorkspacesDir(home = dshHome()) {
  return path.join(home, 'storage', 'backups', 'workspace')
}

/** Directory under which archives are staged before upload. */
export function backupStageDir(home = dshHome()) {
  return path.join(home, 'storage', 'backups', 'stage')
}

/**
 * Trim only leading and trailing whitespace of an encryption key; internal
 * whitespace is preserved because a passphrase may legally contain it.
 *
 * @param value - raw key from the panel.
 * @returns the trimmed key, or '' when nothing remains.
 */
export function trimBackupKey(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Encode a key for the credentials store: UTF-8 bytes -> base64. A passphrase
 * is bytes, not characters, so a stored secret must not depend on the locale.
 */
export function encodeBackupKey(key) {
  return Buffer.from(key, 'utf8').toString('base64')
}

/** Reverse of {@link encodeBackupKey}: base64 -> UTF-8 bytes -> string. */
export function decodeBackupKey(encoded) {
  return Buffer.from(String(encoded), 'base64').toString('utf8')
}

/** Credential reference for a backup entry's encryption key. */
export function makeBackupKeyRef(id) {
  return credentialRef(`DSH_FILESTORE_BACKUP_${String(id).toUpperCase().replaceAll('-', '_')}_KEY`)
}

/** Stable id for a backup position; renaming never changes it. */
export function makeBackupId(index) {
  return `bk-${String(index + 1).padStart(4, '0')}`
}

/** A free backup id, like {@link makeBackupId} but never reused. */
export function nextBackupId(existing) {
  const taken = new Set((existing ?? []).map(entry => (typeof entry === 'string' ? entry : entry?.id)))
  for (let index = 0; index < 10000; index += 1) {
    const candidate = makeBackupId(index)
    if (!taken.has(candidate)) return candidate
  }
  return `bk-${randomUUID().slice(0, 8)}`
}

/** Sanitize a backup name into a safe archive basename prefix. */
export function sanitizeBackupName(name) {
  const cleaned = String(name ?? '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned === '' ? 'backup' : cleaned
}

/** Archive timestamp: `YYYY-MM-DD_HH.mm.ssZ` in UTC. */
export function backupTimestamp(now = new Date()) {
  const p = value => String(value).padStart(2, '0')
  return `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}_${p(now.getUTCHours())}.${p(now.getUTCMinutes())}.${p(now.getUTCSeconds())}Z`
}

/**
 * Normalize one backup entry as stored in the settings document.
 *
 * @param raw - entry as it sits in settings.
 * @param index - list position, used when the id is missing.
 * @param providerIds - configured storage ids, so a dangling provider is caught early.
 * @returns a normalized entry, or `undefined` when it cannot be used.
 */
export function normalizeBackupEntry(raw, index, providerIds = []) {
  if (raw === null || typeof raw !== 'object') return undefined
  const id = typeof raw.id === 'string' && /^bk-[a-z0-9]{4,16}$/i.test(raw.id) ? raw.id : makeBackupId(index)
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (name === '') return undefined
  const providerId = typeof raw.providerId === 'string' ? raw.providerId.trim() : ''
  if (providerId === '') return undefined
  const known = providerIds.length === 0 || providerIds.includes(providerId)
  const rotation = Number.isSafeInteger(raw.rotation) && raw.rotation >= 0 ? Math.min(raw.rotation, MAX_ROTATION) : DEFAULT_ROTATION
  const timeoutSeconds = Number.isSafeInteger(raw.timeoutSeconds) && raw.timeoutSeconds > 0 ? Math.min(raw.timeoutSeconds, MAX_TIMEOUT_SECONDS) : DEFAULT_TIMEOUT_SECONDS
  const ignore = Array.isArray(raw.ignore)
    ? raw.ignore.map(item => String(item).trim()).filter(item => item !== '')
    : []
  const include = Array.isArray(raw.include)
    ? raw.include.map(item => String(item).trim()).filter(item => item !== '')
    : []
  const sections = Array.isArray(raw.sections)
    ? raw.sections.map(item => String(item).trim()).filter(item => item !== '')
    : []
  const credentialRefValue = typeof raw.credentialRef === 'string' && raw.credentialRef.trim() !== ''
    ? credentialRef(raw.credentialRef.trim())
    : makeBackupKeyRef(id)
  return {
    id,
    name,
    providerId,
    known,
    directory: normalizeBackupDirectory(raw.directory),
    rotation,
    timeoutSeconds,
    ignore,
    include,
    sections,
    credentialRef: credentialRefValue,
    schedule: typeof raw.schedule === 'string' ? raw.schedule.trim() : '',
    lastRun: normalizeLastRun(raw.lastRun),
  }
}

/** Normalize a persisted last-run record; `null` when there was no attempt. */
export function normalizeLastRun(raw) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return null
  return {
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : undefined,
    finishedAt: typeof raw.finishedAt === 'string' ? raw.finishedAt : undefined,
    code: typeof raw.code === 'string' ? raw.code : undefined,
    message: typeof raw.message === 'string' ? raw.message : undefined,
  }
}

/** A backup directory is a POSIX path inside the storage, like a base path. */
export function normalizeBackupDirectory(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim().replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '')
  if (trimmed === '') return ''
  for (const segment of trimmed.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new BackupError('BACKUP_BAD_DIRECTORY', `a backup directory cannot contain ${JSON.stringify(segment)}`)
    }
  }
  return trimmed
}

/** Normalize a whole list, dropping entries that cannot be used. */
export function normalizeBackupEntries(list, providerIds = []) {
  const raw = Array.isArray(list) ? list : []
  const entries = []
  for (const [index, item] of raw.entries()) {
    const entry = normalizeBackupEntry(item, index, providerIds)
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

/** Section names must be a single, safe path segment. */
export function normalizeSectionName(name) {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (trimmed === '' || trimmed === '.' || trimmed === '..') {
    throw new BackupError('BACKUP_BAD_SECTION', `a section name cannot be ${JSON.stringify(trimmed)}`)
  }
  if (/[/\\\0]/.test(trimmed)) {
    throw new BackupError('BACKUP_BAD_SECTION', 'a section name must be a single path segment')
  }
  return trimmed
}

/**
 * The workspace handed to `prepare-backup` participants. `section()` is the one
 * sanctioned way to create a section: it validates the name and creates the
 * directory synchronously, because the prepare event is dispatched synchronously.
 */
export class BackupWorkspace {
  /** @param root - absolute directory that already exists. */
  constructor(root) {
    this.root = root
  }

  /** Create (or return) a section directory and return its absolute path. */
  section(name) {
    const safe = normalizeSectionName(name)
    const dir = path.join(this.root, safe)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  /** Absolute path of a section directory, without creating it. */
  sectionDir(name) {
    const safe = normalizeSectionName(name)
    return path.join(this.root, safe)
  }
}

/** List section names (direct subdirectories) in deterministic order. */
export function listSections(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort((left, right) => left.localeCompare(right))
}

/** Whether one glob matches a section name (`*` matches any run of characters). */
export function matchesGlob(name, pattern) {
  const text = String(pattern ?? '').trim()
  if (text === '') return false
  const regex = new RegExp(`^${text.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`)
  return regex.test(name)
}

/** Whether a section name matches any of the patterns. */
export function matchesAnyGlob(name, patterns = []) {
  for (const raw of patterns) if (matchesGlob(name, raw)) return true
  return false
}

/** Whether a section name matches one of the ignore patterns (a glob). */
export function isIgnoredSection(name, patterns = []) {
  return matchesAnyGlob(name, patterns)
}

/**
 * Apply the include/ignore selection to a discovered section list.
 * An empty `include` means `*` (everything); an empty `ignore` excludes nothing;
 * `ignore` always wins over `include`.
 */
export function filterSections(names, { include = [], ignore = [] } = {}) {
  const included = (include?.length ?? 0) === 0
    ? [...names]
    : names.filter(name => matchesAnyGlob(name, include))
  return included.filter(name => !matchesAnyGlob(name, ignore))
}

/** Path of a section's status.json. */
export function sectionStatusPath(directory) {
  return path.join(directory, 'status.json')
}

/**
 * Atomically write a section's status.json via a temporary file + rename. The
 * rename is atomic on the same filesystem, so a reader never sees a half file.
 * Exported so participants use the exact primitive the host validates.
 */
export function atomicWriteStatus(directory, status) {
  const target = sectionStatusPath(directory)
  const temporary = path.join(directory, `.status.${process.pid}.${randomUUID()}.tmp`)
  const body = { pids: [], ...status, updatedAt: new Date().toISOString() }
  writeFileSync(temporary, JSON.stringify(body), 'utf8')
  renameSync(temporary, target)
  return body
}

/**
 * Read a section's status.json.
 *
 * @returns `{ missing: true }`, `{ invalid: true, error, mtimeMs }`, or the
 *   parsed object augmented with `mtimeMs` (the rewrite detection signal).
 */
export function readSectionStatus(directory) {
  const target = sectionStatusPath(directory)
  let raw
  try {
    raw = readFileSync(target, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { missing: true }
    return { invalid: true, error: String(error?.message ?? error) }
  }
  let mtimeMs
  let ino
  try {
    const info = statSync(target)
    mtimeMs = info.mtimeMs
    ino = info.ino
  } catch {
    mtimeMs = undefined
    ino = undefined
  }
  try {
    return { ...JSON.parse(raw), mtimeMs, ino }
  } catch (error) {
    return { invalid: true, error: String(error?.message ?? error), mtimeMs, ino }
  }
}

/** Collect every pid recorded across the workspace's section status files. */
export function collectPids(root) {
  const pids = new Set()
  for (const name of listSections(root)) {
    const status = readSectionStatus(path.join(root, name))
    if (Array.isArray(status?.pids)) {
      for (const pid of status.pids) if (Number.isSafeInteger(pid) && pid > 0) pids.add(pid)
    }
  }
  return [...pids]
}

/** SIGKILL every pid; pids that are already gone are ignored. */
export function killPids(pids) {
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      // ESRCH means the child already exited; nothing to kill.
    }
  }
}

/**
 * Normalize a `backup-start` return value into a list of child pids. Accepts
 * `{ pids: [...] }` or a bare array; anything else is empty.
 */
export function normalizePids(result) {
  const raw = Array.isArray(result) ? result : Array.isArray(result?.pids) ? result.pids : []
  return [...new Set(raw.filter(pid => Number.isSafeInteger(pid) && pid > 0))]
}

/**
 * Dispatch `dsh-storage/backup-start` synchronously and collect the pids the
 * owning hook returned. Uses `ctx.bail` (stops at the first non-empty return);
 * contexts without `bail` return nothing.
 */
export function dispatchBackupStart(ctx, section, directory) {
  const payload = { directory, section }
  if (typeof ctx?.bail === 'function') return ctx.bail('dsh-storage/backup-start', payload)
  return undefined
}

/** Create a fresh workspace directory inside the DSH tree. */
export async function createWorkspace(home = dshHome()) {
  const root = backupWorkspacesDir(home)
  await mkdir(root, { recursive: true })
  const dir = path.join(root, `workspace-${randomUUID()}`)
  await mkdir(dir, { recursive: true })
  return dir
}

/** Remove a workspace (or stage) directory, ignoring absence. */
export async function removeWorkspace(dir) {
  if (typeof dir === 'string' && dir !== '') await rm(dir, { recursive: true, force: true })
}

/**
 * Discovery only: create a workspace, run the synchronous `prepare-backup`, and
 * return the section names. No section events, no archive, no upload; the
 * workspace is removed in `finally`. This backs the "refresh sections" action.
 *
 * @param ctx - cordis context; must expose `emit`.
 * @param options.dshHome - override the DSH tree root (tests).
 * @returns the discovered section names.
 */
export async function discoverSections(ctx, options = {}) {
  const workspace = await createWorkspace(options.dshHome)
  try {
    const handle = new BackupWorkspace(workspace)
    ctx.emit('dsh-storage/prepare-backup', handle)
    return listSections(workspace)
  } finally {
    await removeWorkspace(workspace)
  }
}

/** Recursively collect files and directories under `root` for an archive. */
export function collectEntries(root, { exclude = [], rootName = '' } = {}) {
  const skip = new Set(exclude)
  const entries = []
  const relOf = childRel => (rootName === '' ? childRel : `${rootName}/${childRel}`)
  if (rootName !== '') {
    entries.push({ rel: rootName, abs: root, type: '5', size: 0, mtime: statSync(root).mtimeMs })
  }
  const walk = (dir, rel) => {
    const names = readdirSync(dir, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))
    for (const dirent of names) {
      if (rel === '' && skip.has(dirent.name)) continue
      const absolute = path.join(dir, dirent.name)
      const childRel = rel === '' ? dirent.name : `${rel}/${dirent.name}`
      const info = statSync(absolute)
      if (dirent.isDirectory()) {
        entries.push({ rel: relOf(childRel), abs: absolute, type: '5', size: 0, mtime: info.mtimeMs })
        walk(absolute, childRel)
      } else if (dirent.isFile()) {
        entries.push({ rel: relOf(childRel), abs: absolute, type: '0', size: info.size, mtime: info.mtimeMs })
      }
      // Symlinks and special files are skipped: a backup must not chase them.
    }
  }
  walk(root, '')
  return entries
}

/** Right-aligned octal field with a NUL terminator. */
function octal(value, length) {
  const text = value.toString(8)
  if (text.length > length - 1) throw new BackupError('BACKUP_ARCHIVE', `tar field value too large: ${text}`)
  return text.padStart(length - 1, '0') + '\0'
}

/** Split a POSIX path into ustar `name` (<=100) and `prefix` (<=155). */
function splitUstarPath(rel) {
  if (Buffer.byteLength(rel) <= 100) return { name: rel, prefix: '' }
  const segments = rel.split('/')
  let name = ''
  let prefix = ''
  while (segments.length > 0) {
    const candidate = segments.pop()
    const candidateName = candidate + (name === '' ? '' : `/${name}`)
    if (Buffer.byteLength(candidateName) <= 100) {
      name = candidateName
      break
    }
    name = candidateName
  }
  prefix = segments.join('/')
  if (Buffer.byteLength(prefix) > 155) throw new BackupError('BACKUP_ARCHIVE', `tar path too long: ${rel}`)
  return { name, prefix }
}

/** One 512-byte ustar header for a file or directory entry. */
export function tarHeader(entry) {
  const { name, prefix } = splitUstarPath(entry.rel)
  const header = Buffer.alloc(512)
  const put = (offset, text) => header.write(text, offset, 'utf8')
  put(0, name)
  put(100, octal(entry.mode ?? (entry.type === '5' ? 0o755 : 0o644), 8))
  put(108, octal(0, 8)) // uid
  put(116, octal(0, 8)) // gid
  put(124, octal(entry.size ?? 0, 12))
  put(136, octal(Math.floor((entry.mtime ?? 0) / 1000), 12))
  put(148, '        ') // chksum placeholder, filled below
  put(156, entry.type === '5' ? '5' : '0')
  put(157, '') // linkname empty
  header.write('ustar\0', 257, 'utf8')
  header.write('00', 263, 'utf8')
  put(265, '') // uname
  put(297, '') // gname
  put(329, octal(0, 8)) // devmajor
  put(337, octal(0, 8)) // devminor
  put(345, prefix)
  let checksum = 0
  for (let index = 0; index < 512; index += 1) checksum += header[index]
  const chksumText = checksum.toString(8).padStart(6, '0')
  if (chksumText.length > 6) throw new BackupError('BACKUP_ARCHIVE', 'tar checksum overflow')
  header.write(`${chksumText}\0 `, 148, 'utf8')
  return header
}

/** Yield the tar byte chunks of a workspace; files are read streaming. */
export async function* tarChunks(root, options = {}) {
  for (const entry of collectEntries(root, options)) {
    yield tarHeader(entry)
    if (entry.type === '0' && entry.size > 0) {
      const stream = createReadStream(entry.abs)
      for await (const chunk of stream) yield chunk
      const remainder = entry.size % 512
      if (remainder !== 0) yield Buffer.alloc(512 - remainder)
    }
  }
  yield Buffer.alloc(1024) // two zero blocks mark the end
}

/** A Node Readable of the workspace tar. */
export function tarWorkspace(root, options = {}) {
  return Readable.from(tarChunks(root, options))
}

/**
 * Wrap a Node Readable with OpenPGP password encryption, streaming. The result
 * is a standard OpenPGP binary message that CLI `gpg` can decrypt.
 */
export async function encryptStream(nodeReadable, key) {
  const webStream = Readable.toWeb(nodeReadable)
  const message = await openpgp.createMessage({ binary: webStream })
  const encrypted = await openpgp.encrypt({ message, passwords: [key], format: 'binary' })
  return Readable.fromWeb(encrypted)
}

/** The open, secret-free description of the outer container. */
export const CONTAINER_RESTORE_MD = `# Резервная копия dsh-storage — контейнер

Этот файл описывает контейнер (внешний tar). Секретов здесь нет.

## Структура

Внешний tar содержит только файлы верхнего уровня:

- \`RESTORE.md\` — этот файл (общий, открытый).
- \`<section>.tar.zstd[.gpg]\` — архив одной секции: tar с корневым каталогом
  секции (Unix-права/режимы сохраняются), сжатый zstd и зашифрованный OpenPGP
  паролем бэкапа. Внутри него лежит и section-specific \`RESTORE.md\` секции.
- \`status.json\` — служебный статус обработки, в контейнер не входит.

## Распаковка

1. Внешний архив — обычный tar: \`tar -xf <name>.tar\`.
2. Для каждой нужной секции расшифруйте section-архив (если он с \`.gpg\`):

   \`\`\`
   gpg --batch --yes --pinentry-mode loopback --passphrase "<ключ>" \\
     -d <section>.tar.zstd.gpg > <section>.tar.zstd
   \`\`\`

3. Распакуйте: \`zstd -dc <section>.tar.zstd | tar -xf -\` — создастся каталог
   \`<section>/\` с содержимым.

## Восстановление

См. \`RESTORE.md\` внутри каждого \`<section>.tar.zstd\` — там порядок
восстановления и проверки конкретной секции.
`

/**
 * Build one section's archive: a tar (Unix permissions preserved) of the
 * section's data files, rooted at the section's directory name, zstd-compressed
 * and optionally encrypted with OpenPGP. `status.json` is excluded (service
 * state); the section's own `RESTORE.md` stays inside the archive.
 */
export async function buildSectionPayload(sectionName, sectionDir, outFile, key) {
  const tar = tarWorkspace(sectionDir, { exclude: ['status.json'], rootName: sectionName })
  const zstd = tar.pipe(createZstdCompress())
  const source = key === '' ? zstd : await encryptStream(zstd, key)
  await pipeline(source, createWriteStream(outFile))
}

/**
 * Build the outer container: a plain tar holding only top-level files — the
 * container-level `RESTORE.md` and one `<section>.tar.zstd[.gpg]` per selected
 * section. No `sections/` subdirectories. The outer tar is always
 * `<name>_<ts>.tar` with a `.sha256` sidecar; there is never a `.gpg` outside.
 *
 * @returns `{ archivePath, shaPath, archiveName, shaName, sha256, size, encrypted }`.
 */
export async function buildBackupContainer(workspace, stage, { name, key = '', sections = [], now = new Date() } = {}) {
  await mkdir(stage, { recursive: true })
  const container = path.join(stage, 'container')
  await mkdir(container, { recursive: true })

  const suffix = key === '' ? '.tar.zstd' : '.tar.zstd.gpg'
  for (const section of sections) {
    const sectionDir = path.join(workspace, section)
    await buildSectionPayload(section, sectionDir, path.join(container, `${section}${suffix}`), key)
  }
  await writeFile(path.join(container, 'RESTORE.md'), CONTAINER_RESTORE_MD, 'utf8')

  const base = `${sanitizeBackupName(name)}_${backupTimestamp(now)}.tar`
  const archiveName = base
  const shaName = `${base}.sha256`
  const archivePath = path.join(stage, archiveName)
  const shaPath = path.join(stage, shaName)

  const hasher = createHash('sha256')
  const hashing = new Transform({
    transform(chunk, _encoding, callback) {
      hasher.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(tarWorkspace(container), hashing, createWriteStream(archivePath))
  const sha256 = hasher.digest('hex')
  await writeFile(shaPath, `${sha256}  ${archiveName}\n`, 'utf8')
  return { archivePath, shaPath, archiveName, shaName, sha256, size: statSync(archivePath).size, encrypted: key !== '' }
}

/** Match an outer archive file name for a sanitized backup prefix. */
export function archiveNamePattern(prefix) {
  return new RegExp(`^${prefix.replace(/[.+?^${}()|[\]\\]/g, '\\$&')}_\\d{4}-\\d{2}-\\d{2}_\\d{2}\\.\\d{2}\\.\\d{2}Z\\.tar$`)
}

/**
 * Rotate old archive pairs in a storage directory. Each archive and its `.sha256`
 * sidecar form a pair; only the `keep` newest pairs survive.
 *
 * @returns `{ deleted }` with the number of deleted objects.
 */
export async function rotateBackups(driver, directory, name, keep) {
  const prefix = sanitizeBackupName(name)
  const pattern = archiveNamePattern(prefix)
  const { items } = await driver.list(directory, { limit: MAX_ROTATION + 100 })
  const archives = items
    .filter(item => item?.type === 'file' && pattern.test(path.posix.basename(item.key)))
    .map(item => item.key)
    .sort((left, right) => right.localeCompare(left))
  let deleted = 0
  for (const key of archives.slice(keep)) {
    const result = await driver.delete(key).catch(() => undefined)
    if (result?.deleted === true) deleted += 1
    const shaKey = `${key}.sha256`
    const shaResult = await driver.delete(shaKey).catch(() => undefined)
    if (shaResult?.deleted === true) deleted += 1
  }
  return { deleted }
}

/**
 * Classify a section from the evidence available right now. Returns an
 * `outcome`; `'running'` means "keep polling".
 *
 * The rewrite signal is the inode: an atomic temp-file + rename replaces the
 * inode, immune to filesystem clock granularity.
 */
export function classifySection({ name, directory, beforeIno, thrown, settled, timedOut, delegated = false }) {
  const status = readSectionStatus(directory)
  const pids = Array.isArray(status?.pids) ? status.pids : []
  const rewrote = !status.missing && status.ino !== undefined && status.ino !== beforeIno

  // A rejected handler is an error even if it also wrote a status.
  if (thrown !== undefined) {
    return { name, outcome: 'error-status', message: String(thrown?.message ?? thrown), pids, ...(rewrote ? { status: status.status } : {}) }
  }
  if (rewrote) {
    if (status.invalid) return { name, outcome: 'error-status', message: `status.json is invalid: ${status.error}`, pids }
    if (status.status === 'ok') return { name, outcome: 'ok', message: status.message ?? 'ok', pids, status: 'ok' }
    if (status.status === 'child-failed') return { name, outcome: 'child-failure', message: status.message ?? 'a child process failed', pids, status: 'child-failed' }
    if (status.status === 'error') return { name, outcome: 'error-status', message: status.message ?? 'section reported an error', pids, status: 'error' }
    // Rewritten but not terminal (e.g. still 'running').
    if (timedOut) return { name, outcome: 'timeout', message: 'section exceeded its timeout', pids, status: status.status }
    return { name, outcome: 'running', pids, status: status.status }
  }
  // Never rewritten. When backup-start handed the section to a child process
  // (delegated), the section handler may return without touching status.json —
  // the child owns it — so only the deadline decides "no status update".
  if (delegated) {
    if (timedOut) return { name, outcome: 'timeout', message: 'section exceeded its timeout', pids, status: status.status }
    return { name, outcome: 'running', pids }
  }
  if (settled || timedOut) {
    return { name, outcome: 'no-status-update', message: 'receiver did not rewrite status.json', pids }
  }
  return { name, outcome: 'running', pids }
}

/**
 * Run one section: fire the section event (without blocking on the handler's
 * promise), then poll `status.json` at most once per second until it reaches a
 * terminal status, the handler rejects, or the timeout elapses. Thrown errors
 * from the handler are captured, never lost, and never left unhandled.
 *
 * @returns a classified section result (see {@link classifySection}).
 */
export async function processSection(ctx, { directory, section, timeoutMs, pollIntervalMs = POLL_INTERVAL_MS, sleep = defaultSleep, delegated = false } = {}) {
  const beforeIno = readSectionStatus(directory).ino
  const controller = new AbortController()
  let thrown
  let settled = false
  const eventPromise = ctx.parallel('dsh-storage/backup-section', { directory, section, signal: controller.signal })
  eventPromise.then(() => { settled = true }, error => { settled = true; thrown = error })
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const timedOut = Date.now() >= deadline
    const result = classifySection({ name: section, directory, beforeIno, thrown, settled, timedOut, delegated })
    if (result.outcome !== 'running') {
      if (timedOut) controller.abort()
      return result
    }
    // Never oversleep the deadline; never poll faster than the interval.
    await sleep(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())))
  }
}

/**
 * Run one backup end to end. This is the vertical slice the admin "run" button
 * and the cron tick both call.
 *
 * @param ctx - cordis context; must expose `emit` and `parallel`.
 * @param entry - normalized backup entry.
 * @param filestore - the Filestore service, for the storage driver.
 * @param resolveSecret - resolves the encryption key credential (raw base64).
 * @param options.logger - logger with `error`; defaults to console.
 * @param options.now - clock for the archive timestamp.
 * @param options.persistSections - called with the discovered section names after
 *   prepare, before include/ignore filtering.
 * @param options.pollIntervalMs - status poll interval; defaults to 1000.
 * @param options.sleep - delay function `(ms) => Promise`; defaults to setTimeout.
 * @returns `{ code, message, details }`, and `archive` on success.
 */
export async function runBackup(ctx, entry, filestore, resolveSecret, options = {}) {
  const logger = options.logger ?? console
  const now = options.now ?? (() => new Date())
  const sleep = typeof options.sleep === 'function' ? options.sleep : defaultSleep
  const timeoutMs = (entry.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000
  const pollIntervalMs = Number.isInteger(options.pollIntervalMs) && options.pollIntervalMs > 0 ? options.pollIntervalMs : POLL_INTERVAL_MS
  const workspace = await createWorkspace(options.dshHome)
  const stage = path.join(backupStageDir(options.dshHome), `stage-${randomUUID()}`)
  const startPids = new Set()
  try {
    const handle = new BackupWorkspace(workspace)

    // 1. Participants create sections synchronously.
    ctx.emit('dsh-storage/prepare-backup', handle)

    // 2. Persist the discovered list regardless of the include/ignore subset.
    const discovered = listSections(workspace)
    if (typeof options.persistSections === 'function') {
      try {
        await options.persistSections(discovered)
      } catch (error) {
        logger.error?.(`[dsh-storage] could not persist discovered sections: ${String(error?.message ?? error)}`)
      }
    }

    // 3. Select the subset: empty include means `*`, ignore always wins.
    const sections = filterSections(discovered, { include: entry.include, ignore: entry.ignore })
    const ignored = discovered.filter(name => !sections.includes(name))
    const details = ignored.map(name => ({ name, outcome: 'ignored', message: 'ignored' }))

    // 4. An empty selection is a clean no-op: no archive, no upload.
    if (sections.length === 0) {
      return { code: 'ok', message: 'empty backup was not uploaded', details: { sections: details, killed: [], discovered } }
    }

    // 5. Process sections strictly sequentially. Each section first gets a
    //    synchronous `backup-start` (hook returns child pids), the engine records
    //    them as a `running` status, then the usual section event + polling runs.
    for (const name of sections) {
      const directory = path.join(workspace, name)
      const hookPids = normalizePids(dispatchBackupStart(ctx, name, directory))
      for (const pid of hookPids) startPids.add(pid)
      atomicWriteStatus(directory, { status: 'running', pids: hookPids })
      const result = await processSection(ctx, { directory, section: name, timeoutMs, pollIntervalMs, sleep, delegated: hookPids.length > 0 })
      details.push(result)
      if (result.outcome !== 'ok') {
        const pids = [...new Set([...startPids, ...collectPids(workspace)])]
        killPids(pids)
        return {
          code: codeForOutcome(result.outcome),
          message: `section ${JSON.stringify(name)} failed: ${result.message}`,
          details: { sections: details, killed: pids, discovered },
        }
      }
      await sleep(0) // explicit yield between sections
    }

    // 6. Container, upload, rotate.
    let key = ''
    try {
      const resolved = await resolveSecret(entry.credentialRef)
      const value = resolved === null || resolved === undefined ? undefined : (typeof resolved === 'string' ? resolved : resolved.value)
      if (typeof value === 'string' && value !== '') key = decodeBackupKey(value)
    } catch {
      key = ''
    }
    const built = await buildBackupContainer(workspace, stage, { name: entry.name, key, sections, now: now() })
    const driver = filestore.driver(entry.providerId)
    const dirKey = entry.directory ?? ''
    const archiveKey = dirKey === '' ? built.archiveName : `${dirKey}/${built.archiveName}`
    const shaKey = `${archiveKey}.sha256`
    await driver.putFile(archiveKey, built.archivePath)
    await driver.putFile(shaKey, built.shaPath)
    const rotation = await rotateBackups(driver, dirKey, entry.name, entry.rotation)

    return {
      code: 'ok',
      message: `uploaded ${built.archiveName} to ${entry.providerId}${dirKey === '' ? '' : `/${dirKey}`}, sha256 ${built.sha256.slice(0, 12)}…`,
      details: { sections: details, killed: [], rotation, discovered },
      archive: { name: built.archiveName, sha256: built.sha256, size: built.size, key: archiveKey, encrypted: key !== '' },
    }
  } catch (error) {
    // Any unexpected failure: kill children, report a structured error.
    const pids = [...new Set([...startPids, ...collectPids(workspace)])].filter(pid => pid !== process.pid)
    killPids(pids)
    const mapped = error instanceof BackupError ? error : new BackupError('BACKUP_FAILED', String(error?.message ?? error))
    logger.error?.(`[dsh-storage] backup ${entry.name} failed: ${mapped.code} ${mapped.message}`)
    return {
      code: mapped.code,
      message: mapped.message,
      details: { sections: [], killed: pids },
    }
  } finally {
    await removeWorkspace(workspace)
    await removeWorkspace(stage)
  }
}

/**
 * In-memory run registry: one active run per backup id within this process.
 * The single-threaded event loop makes the synchronous `acquireRun` check atomic
 * enough for the required same-process race protection.
 */
const activeRuns = new Map()

/** Claim a run for `id`; throws `BACKUP_ALREADY_RUNNING` when it is busy. */
export function acquireRun(id, meta = {}) {
  if (activeRuns.has(id)) {
    throw new BackupError('BACKUP_ALREADY_RUNNING', `backup ${id} is already running`)
  }
  const run = { id, startedAt: new Date().toISOString(), phase: 'running', pids: [], ...meta }
  activeRuns.set(id, run)
  return run
}

/** Release a run's lock; a no-op when it was not held. */
export function releaseRun(id) {
  activeRuns.delete(id)
}

/** The live run record for `id`, or `undefined`. */
export function getRun(id) {
  return activeRuns.get(id)
}

/** Readable run state for list surfaces: running + startedAt + phase. */
export function runStateOf(id) {
  const run = activeRuns.get(id)
  return run === undefined
    ? { running: false, startedAt: null, phase: null }
    : { running: true, startedAt: run.startedAt, phase: run.phase }
}

/**
 * Run one backup under the per-id lock. A concurrent run of the same id returns
 * `{ code: 'BACKUP_ALREADY_RUNNING', ... }` instead of starting. The lock is
 * released in `finally` on success, structured error and thrown error alike.
 *
 * `options.persistLastRun(lastRun)` is called at start (startedAt +
 * `code: 'running'`) and again once the attempt settles (finishedAt + code +
 * message), so a restart or a later fetch can read the last attempt.
 */
export async function runBackupLocked(ctx, entry, filestore, resolveSecret, options = {}) {
  let run
  try {
    run = acquireRun(entry.id)
  } catch (error) {
    if (error instanceof BackupError && error.code === 'BACKUP_ALREADY_RUNNING') {
      return { code: 'BACKUP_ALREADY_RUNNING', message: error.message, details: { sections: [], killed: [] } }
    }
    throw error
  }
  const startedAt = run.startedAt
  const persistLastRun = typeof options.persistLastRun === 'function' ? options.persistLastRun : async () => {}
  await Promise.resolve(persistLastRun({ startedAt, code: 'running' })).catch(() => {})
  try {
    const result = await runBackup(ctx, entry, filestore, resolveSecret, options)
    await Promise.resolve(persistLastRun({ startedAt, finishedAt: new Date().toISOString(), code: result.code, message: result.message })).catch(() => {})
    return result
  } catch (error) {
    const mapped = error instanceof BackupError ? error : new BackupError('BACKUP_FAILED', String(error?.message ?? error))
    await Promise.resolve(persistLastRun({ startedAt, finishedAt: new Date().toISOString(), code: mapped.code, message: mapped.message })).catch(() => {})
    throw error
  } finally {
    releaseRun(entry.id)
  }
}
