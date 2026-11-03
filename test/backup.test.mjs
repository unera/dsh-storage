import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  atomicWriteStatus, archiveNamePattern, backupTimestamp, BackupWorkspace, buildBackupContainer, buildSectionPayload,
  classifySection, collectPids, decodeBackupKey, discoverSections, dispatchBackupStart, encodeBackupKey, filterSections,
  isIgnoredSection, makeBackupId, makeBackupKeyRef, nextBackupId, normalizeBackupEntry, normalizePids, processSection,
  readSectionStatus, runBackup, sanitizeBackupName, trimBackupKey,
} from '../backup.mjs'
import { createLocalDriver, normalizeEntry } from '../index.mjs'

async function withStorage(run) {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-'))
  const dshHome = path.join(root, 'dsh')
  const storageRoot = path.join(root, 'storage')
  mkdirSync(dshHome, { recursive: true })
  mkdirSync(storageRoot, { recursive: true })
  const entry = normalizeEntry({ id: 'st-0001', type: 'local', role: 'primary', options: { root: storageRoot } }, 0)
  const driver = createLocalDriver(entry)
  try {
    return await run({ root, dshHome, storageRoot, driver, filestore: { driver: () => driver } })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** A fake ctx whose participants create sections and mark them ok synchronously. */
function okCtx() {
  return {
    emit(_name, workspace) {
      workspace.section('db')
      writeFileSync(path.join(workspace.sectionDir('db'), 'dump.sql'), 'SELECT 1')
      workspace.section('logs')
      writeFileSync(path.join(workspace.sectionDir('logs'), 'app.log'), 'x')
    },
    async parallel(_name, { directory }) {
      atomicWriteStatus(directory, { status: 'ok', pids: [] })
    },
  }
}

test('a backup key trims only outer whitespace and round-trips through base64', () => {
  assert.equal(trimBackupKey('  pass   phrase  '), 'pass   phrase')
  assert.equal(decodeBackupKey(encodeBackupKey('pass   phrase')), 'pass   phrase')
})

test('a backup name sanitizes and the outer archive is always a plain tar', () => {
  assert.equal(sanitizeBackupName(' Daily/Backup '), 'Daily-Backup')
  assert.equal(backupTimestamp(new Date('2026-11-03T16:51:32Z')), '2026-11-03_16.51.32Z')
  assert.match('daily_2026-11-03_16.51.32Z.tar', archiveNamePattern('daily'))
  assert.doesNotMatch('daily_2026-11-03_16.51.32Z.tar.gpg', archiveNamePattern('daily'))
})

test('backup ids are stable and never reused', () => {
  assert.equal(makeBackupId(0), 'bk-0001')
  assert.equal(nextBackupId([{ id: 'bk-0001' }, { id: 'bk-0003' }]), 'bk-0002')
  assert.match(String(makeBackupKeyRef('bk-0001')), /^DSH_FILESTORE_BACKUP_BK_0001_KEY$/)
})

test('a backup entry normalizes include/ignore/sections and defaults', () => {
  const entry = normalizeBackupEntry({ name: 'daily', providerId: 'st-0001', include: ['db'], ignore: ['logs'], sections: ['a', 'b'] }, 0, ['st-0001'])
  assert.equal(entry.rotation, 10)
  assert.equal(entry.timeoutSeconds, 300)
  assert.deepEqual(entry.include, ['db'])
  assert.deepEqual(entry.ignore, ['logs'])
  assert.deepEqual(entry.sections, ['a', 'b'])
  assert.equal(normalizeBackupEntry({ providerId: 'st-0001' }, 0), undefined)
})

test('the workspace only accepts single-segment section names', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-ws-'))
  try {
    const ws = new BackupWorkspace(root)
    const dir = ws.section('db')
    assert.equal(existsSync(dir), true)
    assert.throws(() => ws.section('../escape'), /single path segment/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('glob matching: include empty means *, ignore wins over include', () => {
  assert.equal(isIgnoredSection('logs', ['logs', '*.tmp']), true)
  assert.deepEqual(filterSections(['db', 'logs', 'cache'], { include: [], ignore: [] }), ['db', 'logs', 'cache'])
  assert.deepEqual(filterSections(['db', 'logs'], { include: ['db', 'logs'], ignore: ['logs'] }), ['db'])
  assert.deepEqual(filterSections(['db', 'logs'], { include: [], ignore: ['logs'] }), ['db'])
  assert.deepEqual(filterSections(['db', 'logs'], { include: ['*db*'], ignore: [] }), ['db'])
})

test('atomicWriteStatus rewrites status.json and replaces its inode even with the same content', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-status-'))
  try {
    atomicWriteStatus(root, { status: 'ok', pids: [1] })
    const first = readSectionStatus(root)
    atomicWriteStatus(root, { status: 'ok', pids: [1] })
    const second = readSectionStatus(root)
    assert.notEqual(second.ino, first.ino, 'a rewrite must be detectable via inode')
    assert.equal(readSectionStatus(path.join(root, 'nope')).missing, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('buildSectionPayload emits a gpg-wrapped zstd tar rooted at the section, RESTORE.md inside', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-payload-'))
  try {
    const section = path.join(root, 'db')
    mkdirSync(path.join(section, 'sub'), { recursive: true })
    writeFileSync(path.join(section, 'dump.sql'), 'SELECT 1')
    writeFileSync(path.join(section, 'sub', 'x.txt'), 'x')
    writeFileSync(path.join(section, 'RESTORE.md'), '# restore')
    writeFileSync(path.join(section, 'status.json'), '{}')
    const out = path.join(root, 'db.tar.zstd.gpg')
    await buildSectionPayload('db', section, out, 'topsecret')
    const dec = execFileSync('gpg', ['--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase', 'topsecret', '-d', out])
    const tar = execFileSync('zstd', ['-dc'], { input: dec })
    const listing = execFileSync('tar', ['-tf', '-'], { input: tar, encoding: 'utf8' })
    assert.match(listing, /db\/dump\.sql/)
    assert.match(listing, /db\/sub\/x\.txt/)
    assert.match(listing, /db\/RESTORE\.md/, 'section RESTORE.md stays inside the archive')
    assert.doesNotMatch(listing, /status\.json/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('buildBackupContainer produces a flat outer tar: RESTORE.md + <section>.tar.zstd.gpg', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-outer-'))
  try {
    const workspace = path.join(root, 'ws')
    const stage = path.join(root, 'stage')
    mkdirSync(path.join(workspace, 'db'), { recursive: true })
    writeFileSync(path.join(workspace, 'db', 'dump.sql'), 'SELECT 1')
    writeFileSync(path.join(workspace, 'db', 'RESTORE.md'), '# db restore')
    writeFileSync(path.join(workspace, 'db', 'status.json'), '{}')
    const built = await buildBackupContainer(workspace, stage, { name: 'daily', key: 'topsecret', sections: ['db'], now: new Date('2026-11-03T16:51:32Z') })
    assert.equal(built.archiveName, 'daily_2026-11-03_16.51.32Z.tar')
    assert.match(readFileSync(built.shaPath, 'utf8'), /^[0-9a-f]{64}  daily_2026-11-03_16\.51\.32Z\.tar\n$/)
    const listing = execFileSync('tar', ['-tf', built.archivePath], { encoding: 'utf8' })
    assert.match(listing, /RESTORE\.md/)
    assert.match(listing, /db\.tar\.zstd\.gpg/)
    assert.doesNotMatch(listing, /sections\//, 'no sections/ subdirectory in the flat container')
    // The section archive is decryptable and rooted at db/.
    const payload = execFileSync('tar', ['-xOf', built.archivePath, 'db.tar.zstd.gpg'])
    const dec = execFileSync('gpg', ['--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase', 'topsecret', '-d'], { input: payload })
    const tar = execFileSync('zstd', ['-dc'], { input: dec })
    const inner = execFileSync('tar', ['-tf', '-'], { input: tar, encoding: 'utf8' })
    assert.match(inner, /db\/dump\.sql/)
    assert.match(inner, /db\/RESTORE\.md/)
    assert.doesNotMatch(inner, /status\.json/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('discoverSections runs prepare only and removes the workspace in finally', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-disc-'))
  const dshHome = path.join(root, 'dsh')
  mkdirSync(dshHome, { recursive: true })
  try {
    const ctx = {
      emit(_name, workspace) {
        workspace.section('a')
        workspace.section('b')
      },
    }
    const sections = await discoverSections(ctx, { dshHome })
    assert.deepEqual(sections, ['a', 'b'])
    const workspacesDir = path.join(dshHome, 'storage', 'backups', 'workspace')
    const leftover = existsSync(workspacesDir) ? readdirSync(workspacesDir).filter(name => name.startsWith('workspace-')) : []
    assert.deepEqual(leftover, [], 'the workspace must be removed in finally')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('processSection polls with yield and finishes on terminal status', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-poll-'))
  try {
    const calls = []
    const sleep = ms => { calls.push(ms); return new Promise(resolve => setTimeout(resolve, ms)) }
    const ctx = {
      async parallel(_name, { directory }) {
        atomicWriteStatus(directory, { status: 'running', pids: [] })
        setTimeout(() => atomicWriteStatus(directory, { status: 'ok', pids: [] }), 50)
      },
    }
    const result = await processSection(ctx, { directory: root, section: 'db', timeoutMs: 5000, pollIntervalMs: 20, sleep })
    assert.equal(result.outcome, 'ok')
    assert.ok(calls.length >= 2, `must yield between polls (got ${calls.length})`)
    assert.ok(calls.every(ms => ms <= 20), 'never polls faster than the interval')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('classifySection keeps timeout, no-status-update, error and child-failure distinct', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-backup-class-'))
  try {
    assert.equal(classifySection({ name: 'a', directory: dir, beforeIno: undefined, thrown: undefined, settled: true, timedOut: false }).outcome, 'no-status-update')
    assert.equal(classifySection({ name: 'a', directory: dir, beforeIno: undefined, thrown: new Error('boom'), settled: true, timedOut: false }).outcome, 'error-status')
    const staleIno = readSectionStatus(dir).ino
    atomicWriteStatus(dir, { status: 'running', pids: [] })
    assert.equal(classifySection({ name: 'a', directory: dir, beforeIno: staleIno, thrown: undefined, settled: false, timedOut: true }).outcome, 'timeout')
    assert.equal(classifySection({ name: 'a', directory: dir, beforeIno: staleIno, thrown: undefined, settled: false, timedOut: false }).outcome, 'running')
    atomicWriteStatus(dir, { status: 'child-failed', pids: [] })
    assert.equal(classifySection({ name: 'a', directory: dir, beforeIno: staleIno, thrown: undefined, settled: false, timedOut: false }).outcome, 'child-failure')
    atomicWriteStatus(dir, { status: 'ok', pids: [] })
    assert.equal(classifySection({ name: 'a', directory: dir, beforeIno: staleIno, thrown: undefined, settled: false, timedOut: false }).outcome, 'ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a successful backup uploads a plain tar pair and rotates old pairs', async () => {
  await withStorage(async ({ dshHome, driver }) => {
    const old = 'daily_2020-01-01_00.00.00Z.tar'
    writeFileSync(path.join(dshHome, 'x'), 'old')
    await driver.putFile(`bk/${old}`, path.join(dshHome, 'x'))
    await driver.putFile(`bk/${old}.sha256`, path.join(dshHome, 'x'))

    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 1, timeoutSeconds: 5, ignore: ['logs'], include: [], credentialRef: 'X' }
    const result = await runBackup(okCtx(), entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 20 })
    assert.equal(result.code, 'ok')
    assert.match(result.archive.name, /^daily_.*\.tar$/)
    const { items } = await driver.list('bk')
    const keys = items.filter(item => item.type === 'file').map(item => item.key)
    assert.equal(keys.includes(`bk/${old}`), false, 'rotation must delete the old archive pair')
    assert.equal(keys.some(key => key.endsWith('.tar')), true)
    assert.equal(keys.some(key => key.endsWith('.tar.sha256')), true)
    assert.equal(keys.some(key => key.includes('.gpg')), false, 'no .gpg outside the container')
    assert.deepEqual(result.details.discovered.sort(), ['db', 'logs'])
  })
})

test('an empty selection returns ok and uploads nothing', async () => {
  await withStorage(async ({ dshHome, driver }) => {
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: ['*'], include: [], credentialRef: 'X' }
    const ctx = { emit() {}, async parallel() {} }
    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 20 })
    assert.equal(result.code, 'ok')
    assert.equal(result.message, 'empty backup was not uploaded')
    const { items } = await driver.list('bk')
    assert.equal(items.length, 0)
  })
})

test('a receiver that does not update status.json fails with no-status-update', async () => {
  await withStorage(async ({ dshHome, driver }) => {
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: [], include: [], credentialRef: 'X' }
    const ctx = {
      emit(_name, workspace) { workspace.section('db') },
      async parallel() { /* does nothing */ },
    }
    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 20 })
    assert.equal(result.code, 'BACKUP_NO_STATUS_UPDATE')
    assert.equal(result.details.sections[0].outcome, 'no-status-update')
  })
})

test('an error status fails the backup and reports the message', async () => {
  await withStorage(async ({ dshHome, driver }) => {
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: [], include: [], credentialRef: 'X' }
    const ctx = {
      emit(_name, workspace) { workspace.section('db') },
      async parallel(_name, { directory }) { atomicWriteStatus(directory, { status: 'error', message: 'database is down', pids: [] }) },
    }
    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 20 })
    assert.equal(result.code, 'BACKUP_ERROR_STATUS')
    assert.match(result.message, /database is down/)
  })
})

test('a section stuck running exceeds its timeout and its children are killed', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve(signal)))
  try {
    await withStorage(async ({ dshHome, driver }) => {
      const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 0.2, ignore: [], include: [], credentialRef: 'X' }
      const ctx = {
        emit(_name, workspace) { workspace.section('db') },
        async parallel(_name, { directory }) {
          atomicWriteStatus(directory, { status: 'running', pids: [child.pid] })
          await new Promise(() => {})
        },
      }
      const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 20 })
      assert.equal(result.code, 'BACKUP_TIMEOUT')
      assert.equal(result.details.sections[0].outcome, 'timeout')
      assert.deepEqual(result.details.killed, [child.pid])
      assert.equal(await exited, 'SIGKILL')
    })
  } finally {
    child.kill('SIGKILL')
  }
})

test('collectPids merges pids across sections', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-pids-'))
  try {
    mkdirSync(path.join(root, 'a'))
    mkdirSync(path.join(root, 'b'))
    atomicWriteStatus(path.join(root, 'a'), { status: 'running', pids: [11, 12] })
    atomicWriteStatus(path.join(root, 'b'), { status: 'running', pids: [12, 13] })
    assert.deepEqual(collectPids(root).sort(), [11, 12, 13])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('normalizePids accepts {pids} and bare arrays, dedupes and filters', () => {
  assert.deepEqual(normalizePids({ pids: [1, 2, 2, 0, -1, 1.5] }), [1, 2])
  assert.deepEqual(normalizePids([3, 3, 4]), [3, 4])
  assert.deepEqual(normalizePids(undefined), [])
  assert.deepEqual(normalizePids({}), [])
  assert.deepEqual(normalizePids('nope'), [])
})

test('dispatchBackupStart uses ctx.bail and returns nothing without it', () => {
  const ctx = {
    bail(name) {
      assert.equal(name, 'dsh-storage/backup-start')
      return { pids: [7] }
    },
  }
  assert.deepEqual(dispatchBackupStart(ctx, 'db', '/x/db'), { pids: [7] })
  assert.equal(dispatchBackupStart({}, 'db', '/x/db'), undefined)
})

test('backup-start runs before backup-section and sections are strictly sequential', async () => {
  await withStorage(async ({ dshHome, driver }) => {
    const events = []
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: [], include: [], credentialRef: 'X' }
    const ctx = {
      emit(_name, ws) { ws.section('a'); ws.section('b') },
      bail(_name, { section }) { events.push(`start:${section}`); return undefined },
      async parallel(_name, { section, directory }) {
        events.push(`section:${section}`)
        if (section === 'b') await new Promise(resolve => setTimeout(resolve, 30))
        atomicWriteStatus(directory, { status: 'ok', pids: [] })
      },
    }
    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 20 })
    assert.equal(result.code, 'ok')
    assert.deepEqual(events, ['start:a', 'section:a', 'start:b', 'section:b'])
  })
})

test('backup-start pids are written as running and killed on section error', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  const exited = new Promise(resolve => child.once('exit', (_code, signal) => resolve(signal)))
  try {
    await withStorage(async ({ dshHome, driver }) => {
      const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: [], include: [], credentialRef: 'X' }
      const seen = []
      const ctx = {
        emit(_name, ws) { ws.section('db') },
        bail(_name, { section }) { seen.push(['start', section]); return { pids: [child.pid] } },
        async parallel(_name, { directory }) {
          const status = readSectionStatus(directory)
          seen.push(['status', status.status, status.pids])
          atomicWriteStatus(directory, { status: 'error', message: 'boom', pids: [] })
        },
      }
      const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 20 })
      assert.equal(result.code, 'BACKUP_ERROR_STATUS')
      assert.deepEqual(result.details.killed, [child.pid])
      assert.deepEqual(seen[1], ['status', 'running', [child.pid]], 'engine wrote running with the start pids before the section event')
      assert.equal(await exited, 'SIGKILL')
    })
  } finally {
    child.kill('SIGKILL')
  }
})
