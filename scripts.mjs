/**
 * External script participant on top of the backup hooks (the internal hooks are
 * untouched). Every executable regular file in a shared scripts directory is a
 * backup section source, with a small contract:
 *
 *   - `<script> name`          prints exactly one section name to stdout. It is
 *                              trimmed, validated as a safe section name, and
 *                              skipped on error/duplicate (with a diagnostic).
 *   - `<script> restore-doc`   prints the UTF-8 `RESTORE.md` for that section.
 *   - `<script> copy DIR`      runs as a separate child process and copies the
 *                              section's content into `DIR`; exit 0 is ok and
 *                              any nonzero exit is a child failure.
 *
 * Discovery runs inside the synchronous `prepare-backup` event via `spawnSync`
 * with a bounded timeout for `name`/`restore-doc`, so the sync hooks are not
 * disturbed. The `copy` child is spawned by `backup-start`; the engine owns
 * status.json, pids, the per-section timeout and the SIGKILL on failure, while
 * `backup-section` waits for the child and records the terminal status.
 *
 * @module @dr-co/dsh-storage/scripts
 */
import { spawn, spawnSync } from 'node:child_process'
import { accessSync, constants, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { atomicWriteStatus, dshHome, listSections, normalizeSectionName } from './backup.mjs'

/** Default scripts directory, inside the DSH tree. */
export const SCRIPTS_SUBDIR = path.join('storage', 'backups', 'scripts')

/** Bounded time for the synchronous `name`/`restore-doc` commands. */
export const COMMAND_TIMEOUT_MS = 5000

/** Absolute default scripts directory. */
export function defaultScriptsDir(home = dshHome()) {
  return path.join(home, SCRIPTS_SUBDIR)
}

/** Run one script subcommand synchronously with a bounded timeout. */
function runScriptCommand(scriptPath, args, timeoutMs = COMMAND_TIMEOUT_MS) {
  const result = spawnSync(scriptPath, args, { timeout: timeoutMs, encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (result.error) return { ok: false, error: String(result.error?.message ?? result.error) }
  if (result.status !== 0) return { ok: false, error: `exit ${result.status}` }
  return { ok: true, stdout: result.stdout ?? '' }
}

/**
 * Discover regular, user-executable files in the scripts directory, sorted by
 * name. Anything that is not a regular file, or lacks execute permission for
 * the user, is skipped.
 */
export function discoverScripts(dir) {
  let names
  try {
    names = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  const scripts = []
  for (const dirent of names) {
    const absolute = path.join(dir, dirent.name)
    let info
    try {
      info = statSync(absolute)
    } catch {
      continue
    }
    if (!info.isFile()) continue
    try {
      accessSync(absolute, constants.X_OK)
    } catch {
      continue
    }
    scripts.push({ name: dirent.name, path: absolute })
  }
  return scripts.sort((left, right) => left.name.localeCompare(right.name))
}

/** Resolve a script's section name, validated and trimmed. */
export function scriptSectionName(scriptPath, timeoutMs = COMMAND_TIMEOUT_MS) {
  const run = runScriptCommand(scriptPath, ['name'], timeoutMs)
  if (!run.ok) return { ok: false, error: run.error }
  const name = run.stdout.trim()
  if (name === '') return { ok: false, error: 'empty section name' }
  try {
    normalizeSectionName(name)
  } catch (error) {
    return { ok: false, error: `invalid section name: ${String(error?.message ?? error)}` }
  }
  return { ok: true, name }
}

/** Read a script's restore documentation, if any. */
export function scriptRestoreDoc(scriptPath, timeoutMs = COMMAND_TIMEOUT_MS) {
  return runScriptCommand(scriptPath, ['restore-doc'], timeoutMs)
}

/**
 * Register the script participant's three listeners on a context.
 *
 * @param ctx - the plugin context.
 * @param options.scriptsDir - scripts directory; defaults to {@link defaultScriptsDir}.
 * @param options.commandTimeoutMs - bound for `name`/`restore-doc`; default 5s.
 * @returns disposers for the three listeners.
 */
export function installScriptsHook(ctx, { scriptsDir = defaultScriptsDir(), commandTimeoutMs = COMMAND_TIMEOUT_MS } = {}) {
  const sectionToScript = new Map()
  const childMap = new Map()

  const disposePrepare = ctx.on('dsh-storage/prepare-backup', workspace => {
    sectionToScript.clear()
    const scripts = discoverScripts(scriptsDir)
    if (scripts.length === 0) return
    const claimed = new Set(listSections(workspace.root))
    for (const script of scripts) {
      const named = scriptSectionName(script.path, commandTimeoutMs)
      if (!named.ok) {
        console.warn(`[dsh-storage] script ${script.name}: ${named.error}`)
        continue
      }
      if (claimed.has(named.name)) {
        console.warn(`[dsh-storage] script ${script.name}: section ${JSON.stringify(named.name)} is already claimed, skipping`)
        continue
      }
      claimed.add(named.name)
      const directory = workspace.section(named.name)
      const restore = scriptRestoreDoc(script.path, commandTimeoutMs)
      if (restore.ok && restore.stdout.trim() !== '') {
        writeFileSync(path.join(directory, 'RESTORE.md'), restore.stdout, 'utf8')
      } else if (!restore.ok) {
        console.warn(`[dsh-storage] script ${script.name}: restore-doc failed: ${restore.error}`)
      }
      sectionToScript.set(named.name, { path: script.path, script: script.name })
    }
  })

  const disposeStart = ctx.on('dsh-storage/backup-start', payload => {
    const entry = sectionToScript.get(payload?.section)
    if (entry === undefined) return undefined
    const child = spawn(entry.path, ['copy', payload.directory], { stdio: 'ignore' })
    childMap.set(payload.section, child)
    return { pids: [child.pid] }
  })

  const disposeSection = ctx.on('dsh-storage/backup-section', payload => {
    const child = childMap.get(payload?.section)
    if (child === undefined) return undefined
    return (async () => {
      const code = await new Promise(resolve => child.once('exit', resolve))
      try {
        atomicWriteStatus(payload.directory, {
          status: code === 0 ? 'ok' : 'child-failed',
          pids: [child.pid],
          ...(code === 0 ? {} : { message: `copy exited ${code}` }),
        })
      } catch {
        // The engine timed out and already removed the workspace.
      }
      childMap.delete(payload.section)
    })()
  })

  return [disposePrepare, disposeStart, disposeSection]
}
