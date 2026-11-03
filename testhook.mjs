/**
 * Built-in test participant for GUI diagnostics of the backup hooks/status.
 *
 * Always-on by design for now: on every backup it adds a `test` section whose
 * section handler does the following, so an operator can watch the hooks fire
 * in a real backup:
 *   - `prepare-backup`      sync: create the `test` section with a small marker
 *                           and an open RESTORE.md;
 *   - `backup-start`        sync: spawn a child Node process that sleeps for
 *                           `TEST_DURATION_MS` and then atomically writes
 *                           `test/status.json` = `{ status: 'ok', pids: [] }`;
 *                           the hook returns `{ pids: [child.pid] }`;
 *   - `backup-section`      does not block the event: it returns immediately and
 *                           leaves status.json to the child; the engine polls it
 *                           (delegated mode) until `ok`.
 *
 * @module @dr-co/dsh-storage/testhook
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

/** The section this participant owns. */
export const TEST_SECTION_NAME = 'test'

/** How long the test child runs before reporting ok. */
export const TEST_DURATION_MS = 30 * 1000

/**
 * The child program: `node -e <script> <directory> <durationMs>`. It waits the
 * given duration and then atomically writes status.json as ok (temp file +
 * rename), exactly the way the engine validates a section rewrite.
 */
const CHILD_SCRIPT = `
const fs = require('node:fs')
const path = require('node:path')
const directory = process.argv[1]
const durationMs = Number(process.argv[2])
setTimeout(() => {
  const target = path.join(directory, 'status.json')
  const temporary = path.join(directory, '.status.' + process.pid + '.tmp')
  fs.writeFileSync(temporary, JSON.stringify({ status: 'ok', pids: [], updatedAt: new Date().toISOString() }))
  fs.renameSync(temporary, target)
  process.exit(0)
}, durationMs)
`

/** Open, secret-free restore notes for the test section. */
export const TEST_RESTORE_MD = `# test — диагностическая секция

Это встроенный участник dsh-storage для ручной проверки hooks/status в GUI.
Восстанавливать здесь нечего: секция создаётся при каждом backup, дочерний
процесс имитирует 30 секунд работы и пишет \`status.json\` = \`{status: ok}\`.

- \`marker.txt\` — маркер того, что секция создана;
- \`status.json\` — служебный статус, в итоговый контейнер не входит.
`

/**
 * Synchronously create the `test` section with a marker and RESTORE.md.
 *
 * @param workspace - the BackupWorkspace handed to `prepare-backup`.
 * @returns the section directory.
 */
export function prepareTestSection(workspace) {
  const dir = workspace.section(TEST_SECTION_NAME)
  writeFileSync(path.join(dir, 'marker.txt'), 'dsh-storage backup test participant\n', 'utf8')
  writeFileSync(path.join(dir, 'RESTORE.md'), TEST_RESTORE_MD, 'utf8')
  return dir
}

/**
 * Spawn the test child for one section directory.
 *
 * @param directory - absolute section directory.
 * @param durationMs - how long the child runs before writing ok.
 * @returns the child process.
 */
export function spawnTestChild(directory, durationMs = TEST_DURATION_MS) {
  return spawn(process.execPath, ['-e', CHILD_SCRIPT, directory, String(durationMs)], { stdio: 'ignore' })
}

/**
 * Register the test participant's three listeners on a context.
 *
 * @param ctx - the plugin context.
 * @param options.durationMs - child duration; defaults to {@link TEST_DURATION_MS}.
 * @returns disposers for the three listeners.
 */
export function installTestHook(ctx, { durationMs = TEST_DURATION_MS } = {}) {
  const disposePrepare = ctx.on('dsh-storage/prepare-backup', workspace => {
    prepareTestSection(workspace)
  })
  const disposeStart = ctx.on('dsh-storage/backup-start', payload => {
    if (payload?.section !== TEST_SECTION_NAME) return undefined
    const child = spawnTestChild(payload.directory, durationMs)
    return { pids: [child.pid] }
  })
  const disposeSection = ctx.on('dsh-storage/backup-section', payload => {
    // The child owns status.json; this handler must not block the event.
    if (payload?.section !== TEST_SECTION_NAME) return undefined
    return undefined
  })
  return [disposePrepare, disposeStart, disposeSection]
}
