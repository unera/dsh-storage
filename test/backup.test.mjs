import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  atomicWriteStatus, archiveFileName, archiveNamePattern, backupTimestamp, BackupWorkspace, buildArchive,
  classifySection, collectPids, decodeBackupKey, encodeBackupKey, isIgnoredSection, listSections, makeBackupId,
  makeBackupKeyRef, nextBackupId, normalizeBackupEntries, normalizeBackupEntry, readSectionStatus, runBackup,
  sanitizeBackupName, trimBackupKey,
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

/** A fake ctx whose participants create sections and mark them ok. */
function okCtx(mutate = undefined) {
  return {
    emit(_name, workspace) {
      workspace.section('db')
      writeFileSync(path.join(workspace.sectionDir('db'), 'dump.sql'), 'SELECT 1')
      workspace.section('logs')
      writeFileSync(path.join(workspace.sectionDir('logs'), 'app.log'), 'x')
      if (typeof mutate === 'function') mutate(workspace)
    },
    async parallel(_name, { directory, section, signal }) {
      if (typeof mutate === 'function') await mutate({ directory, section, signal })
      else atomicWriteStatus(directory, { status: 'ok', pids: [] })
    },
  }
}

test('a backup key trims only outer whitespace and round-trips through base64', () => {
  const key = '  pass   phrase with  spaces  '
  assert.equal(trimBackupKey(key), 'pass   phrase with  spaces')
  assert.equal(decodeBackupKey(encodeBackupKey('pass   phrase with  spaces')), 'pass   phrase with  spaces')
  assert.equal(trimBackupKey('   '), '')
})

test('a backup name sanitizes to a safe archive prefix and timestamp is UTC', () => {
  assert.equal(sanitizeBackupName(' Daily/Backup '), 'Daily-Backup')
  assert.equal(sanitizeBackupName('   '), 'backup')
  assert.equal(backupTimestamp(new Date('2026-11-03T16:51:32Z')), '2026-11-03_16.51.32Z')
  assert.match('daily_2026-11-03_16.51.32Z.tar', archiveNamePattern('daily'))
  assert.match('daily_2026-11-03_16.51.32Z.tar.gpg', archiveNamePattern('daily'))
  assert.doesNotMatch('other_2026-11-03_16.51.32Z.tar', archiveNamePattern('daily'))
})

test('backup ids are stable and never reused', () => {
  assert.equal(makeBackupId(0), 'bk-0001')
  assert.equal(nextBackupId([{ id: 'bk-0001' }, { id: 'bk-0003' }]), 'bk-0002')
  assert.match(String(makeBackupKeyRef('bk-0001')), /^DSH_FILESTORE_BACKUP_BK_0001_KEY$/)
})

test('a backup entry normalizes with defaults and rejects a nameless entry', () => {
  const entry = normalizeBackupEntry({ name: 'daily', providerId: 'st-0001' }, 0, ['st-0001'])
  assert.equal(entry.name, 'daily')
  assert.equal(entry.rotation, 10)
  assert.equal(entry.timeoutSeconds, 300)
  assert.deepEqual(entry.ignore, [])
  assert.equal(entry.directory, '')
  assert.equal(entry.known, true)
  assert.equal(normalizeBackupEntry({ providerId: 'st-0001' }, 0), undefined)
  const unknown = normalizeBackupEntry({ name: 'x', providerId: 'st-9999' }, 0, ['st-0001'])
  assert.equal(unknown.known, false)
})

test('the workspace only accepts single-segment section names', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-ws-'))
  try {
    const ws = new BackupWorkspace(root)
    const dir = ws.section('db')
    assert.equal(existsSync(dir), true)
    assert.equal(listSections(root).includes('db'), true)
    assert.throws(() => ws.section('../escape'), /single path segment/)
    assert.throws(() => ws.section('a/b'), /single path segment/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ignore patterns match section names as globs', () => {
  assert.equal(isIgnoredSection('logs', ['logs', '*.tmp']), true)
  assert.equal(isIgnoredSection('cache.tmp', ['*.tmp']), true)
  assert.equal(isIgnoredSection('data', ['logs']), false)
})

test('atomicWriteStatus rewrites status.json and replaces its inode even with the same content', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-status-'))
  try {
    atomicWriteStatus(root, { status: 'ok', pids: [1] })
    const first = readSectionStatus(root)
    atomicWriteStatus(root, { status: 'ok', pids: [1] })
    const second = readSectionStatus(root)
    assert.equal(first.status, 'ok')
    assert.equal(second.status, 'ok')
    assert.notEqual(second.ino, first.ino, 'a rewrite must be detectable via inode')
    assert.ok(typeof second.updatedAt === 'string')
    assert.equal(readSectionStatus(path.join(root, 'nope')).missing, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('buildArchive produces a listable tar and a matching sha256 sidecar', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-tar-'))
  try {
    const workspace = path.join(root, 'ws')
    const stage = path.join(root, 'stage')
    mkdirSync(path.join(workspace, 'db'), { recursive: true })
    writeFileSync(path.join(workspace, 'db', 'dump.sql'), 'SELECT 1')
    const built = await buildArchive(workspace, stage, { name: 'daily', now: new Date('2026-11-03T16:51:32Z') })
    assert.equal(built.archiveName, 'daily_2026-11-03_16.51.32Z.tar')
    assert.match(readFileSync(built.shaPath, 'utf8'), /^[0-9a-f]{64}  daily_2026-11-03_16\.51\.32Z\.tar\n$/)
    const listing = execFileSync('tar', ['-tf', built.archivePath], { encoding: 'utf8' })
    assert.match(listing, /db\/dump\.sql/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('an encrypted archive is a standard OpenPGP message the CLI gpg can decrypt', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-backup-gpg-'))
  try {
    const workspace = path.join(root, 'ws')
    const stage = path.join(root, 'stage')
    mkdirSync(path.join(workspace, 'db'), { recursive: true })
    writeFileSync(path.join(workspace, 'db', 'dump.sql'), 'SELECT 1')
    const key = 'secret pass'
    const built = await buildArchive(workspace, stage, { name: 'daily', key, now: new Date('2026-11-03T16:51:32Z') })
    assert.equal(built.archiveName, 'daily_2026-11-03_16.51.32Z.tar.gpg')
    const plain = execFileSync('gpg', ['--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase', key, '-d', built.archivePath], { encoding: 'utf8' })
    // The decrypted bytes are a tar stream; its header magic is "ustar".
    assert.equal(plain.slice(257, 262), 'ustar')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a successful backup uploads the archive and its sha256 and rotates old pairs', async () => {
  await withStorage(async ({ dshHome, driver }) => {
    // Pre-seed one old pair that rotation should delete.
    const old = 'daily_2020-01-01_00.00.00Z.tar'
    writeFileSync(path.join(dshHome, 'x'), 'old')
    await driver.putFile(`bk/${old}`, path.join(dshHome, 'x'))
    await driver.putFile(`bk/${old}.sha256`, path.join(dshHome, 'x'))

    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 1, timeoutSeconds: 5, ignore: ['logs'], credentialRef: 'X' }
    const result = await runBackup(okCtx(), entry, { driver: () => driver }, async () => undefined, { dshHome })
    assert.equal(result.code, 'ok')
    assert.equal(result.archive.encrypted, false)
    const { items } = await driver.list('bk')
    const keys = items.filter(item => item.type === 'file').map(item => item.key)
    assert.equal(keys.includes(`bk/${old}`), false, 'rotation must delete the old archive')
    assert.equal(keys.includes(`bk/${old}.sha256`), false, 'rotation must delete the old sidecar')
    assert.equal(keys.some(key => key.startsWith('bk/daily_') && key.endsWith('.tar')), true)
    assert.equal(keys.some(key => key.endsWith('.sha256')), true)
    assert.deepEqual(result.details.sections.map(item => item.outcome).sort(), ['ignored', 'ok'])
  })
})

test('an empty backup returns ok and uploads nothing', async () => {
  await withStorage(async ({ dshHome, driver }) => {
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: [], credentialRef: 'X' }
    const ctx = {
      emit() {},
      async parallel() {},
    }
    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome })
    assert.equal(result.code, 'ok')
    assert.equal(result.message, 'empty backup was not uploaded')
    assert.equal(result.archive, undefined)
    const { items } = await driver.list('bk')
    assert.equal(items.length, 0)
  })
})

test('a receiver that does not update status.json fails with no-status-update', async () => {
  await withStorage(async ({ dshHome, driver }) => {
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: [], credentialRef: 'X' }
    const ctx = {
      emit(_name, workspace) { workspace.section('db') },
      async parallel() { /* does nothing */ },
    }
    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome })
    assert.equal(result.code, 'BACKUP_NO_STATUS_UPDATE')
    assert.equal(result.details.sections[0].outcome, 'no-status-update')
  })
})

test('an error status fails the backup and reports the message', async () => {
  await withStorage(async ({ dshHome, driver }) => {
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: [], credentialRef: 'X' }
    const ctx = {
      emit(_name, workspace) { workspace.section('db') },
      async parallel(_name, { directory }) { atomicWriteStatus(directory, { status: 'error', message: 'database is down', pids: [] }) },
    }
    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome })
    assert.equal(result.code, 'BACKUP_ERROR_STATUS')
    assert.match(result.message, /database is down/)
  })
})

test('a section that exceeds its timeout fails and its children are killed', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve(signal)))
  try {
    await withStorage(async ({ dshHome, driver }) => {
      const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 0.05, ignore: [], credentialRef: 'X' }
      const ctx = {
        emit(_name, workspace) { workspace.section('db') },
        async parallel(_name, { directory }) {
          atomicWriteStatus(directory, { status: 'running', pids: [child.pid] })
          await new Promise(resolve => setTimeout(resolve, 300))
        },
      }
      const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome })
      assert.equal(result.code, 'BACKUP_TIMEOUT')
      assert.equal(result.details.sections[0].outcome, 'timeout')
      assert.deepEqual(result.details.killed, [child.pid])
      assert.equal(await exited, 'SIGKILL')
    })
  } finally {
    child.kill('SIGKILL')
  }
})

test('a child-failed status is reported distinctly', async () => {
  await withStorage(async ({ dshHome, driver }) => {
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: [], credentialRef: 'X' }
    const ctx = {
      emit(_name, workspace) { workspace.section('db') },
      async parallel(_name, { directory }) { atomicWriteStatus(directory, { status: 'child-failed', message: 'pg_dump exited 1', pids: [] }) },
    }
    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome })
    assert.equal(result.code, 'BACKUP_CHILD_FAILURE')
    assert.equal(result.details.sections[0].outcome, 'child-failure')
  })
})

test('classifySection keeps the four failure kinds distinct', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-backup-class-'))
  try {
    assert.equal(classifySection({ name: 'a', timedOut: true, directory: dir }).outcome, 'timeout')
    assert.equal(classifySection({ name: 'a', timedOut: false, directory: dir }).outcome, 'no-status-update')
    atomicWriteStatus(dir, { status: 'error', pids: [] })
    assert.equal(classifySection({ name: 'a', timedOut: false, directory: dir, beforeIno: undefined }).outcome, 'error-status')
    atomicWriteStatus(dir, { status: 'child-failed', pids: [] })
    assert.equal(classifySection({ name: 'a', timedOut: false, directory: dir, beforeIno: undefined }).outcome, 'child-failure')
    atomicWriteStatus(dir, { status: 'ok', pids: [] })
    assert.equal(classifySection({ name: 'a', timedOut: false, directory: dir, beforeIno: undefined }).outcome, 'ok')
  } finally {
    rmSync(dir, { recursive: true, force: true })
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
