import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { discoverScripts, installScriptsHook, scriptRestoreDoc, scriptSectionName } from '../scripts.mjs'
import { BackupWorkspace, readSectionStatus, runBackup } from '../backup.mjs'
import { prepareSelfSection } from '../selfbackup.mjs'
import { createLocalDriver, normalizeEntry } from '../index.mjs'

function writeExecutable(file, body) {
  writeFileSync(file, body, 'utf8')
  chmodSync(file, 0o755)
}

/** A script implementing the full `name`/`restore-doc`/`copy` contract. */
function writeSectionScript(scriptsDir, name, { sectionName, restoreDoc = '# restore\n', copyFile = 'data.txt' } = {}) {
  const body = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const cmd = process.argv[2]
if (cmd === 'name') { process.stdout.write(${JSON.stringify(sectionName)}); process.exit(0) }
if (cmd === 'restore-doc') { process.stdout.write(${JSON.stringify(restoreDoc)}); process.exit(0) }
if (cmd === 'copy') {
  const dir = process.argv[3]
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, ${JSON.stringify(copyFile)}), 'copied')
  process.exit(0)
}
process.exit(2)
`
  const file = path.join(scriptsDir, name)
  writeExecutable(file, body)
  return file
}

test('discoverScripts keeps only regular user-executable files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-scripts-'))
  try {
    writeExecutable(path.join(dir, 'run.sh'), '#!/bin/sh\n')
    writeFileSync(path.join(dir, 'not-exec'), 'x')
    mkdirSync(path.join(dir, 'subdir'))
    assert.deepEqual(discoverScripts(dir).map(item => item.name), ['run.sh'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('discoverScripts returns an empty list for a missing directory', () => {
  assert.deepEqual(discoverScripts('/nonexistent/dsh-scripts'), [])
})

test('scriptSectionName trims, validates and rejects unsafe names', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-scripts-name-'))
  try {
    const good = path.join(dir, 'good')
    writeExecutable(good, '#!/usr/bin/env node\nprocess.stdout.write("  mydb  ")\n')
    assert.deepEqual(scriptSectionName(good), { ok: true, name: 'mydb' })

    const unsafe = path.join(dir, 'unsafe')
    writeExecutable(unsafe, '#!/usr/bin/env node\nprocess.stdout.write("../evil")\n')
    assert.equal(scriptSectionName(unsafe).ok, false)

    const empty = path.join(dir, 'empty')
    writeExecutable(empty, '#!/usr/bin/env node\n')
    assert.equal(scriptSectionName(empty).ok, false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scriptRestoreDoc returns the stdout', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dsh-scripts-restore-'))
  try {
    const file = path.join(dir, 'doc')
    writeExecutable(file, '#!/usr/bin/env node\nprocess.stdout.write("# my restore\\n")\n')
    const result = scriptRestoreDoc(file)
    assert.equal(result.ok, true)
    assert.equal(result.stdout, '# my restore\n')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('scripts participate: name + restore-doc in prepare, copy child to ok', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-scripts-flow-'))
  try {
    const dshHome = path.join(root, 'dsh')
    const storageRoot = path.join(root, 'storage')
    const scriptsDir = path.join(root, 'scripts')
    mkdirSync(dshHome, { recursive: true })
    mkdirSync(storageRoot, { recursive: true })
    mkdirSync(scriptsDir, { recursive: true })
    writeSectionScript(scriptsDir, 'db.sh', { sectionName: 'mydb', copyFile: 'dump.sql' })

    const ctx = new Context()
    installScriptsHook(ctx, { scriptsDir, commandTimeoutMs: 2000 })
    const driver = createLocalDriver(normalizeEntry({ id: 'st-0001', type: 'local', options: { root: storageRoot } }, 0))
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: ['test'], include: [], credentialRef: 'X' }

    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 50 })
    assert.equal(result.code, 'ok')
    assert.ok(result.details.discovered.includes('mydb'), 'script section discovered')
    const section = result.details.sections.find(item => item.name === 'mydb')
    assert.equal(section.outcome, 'ok')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a hanging copy script is killed by the section timeout', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-scripts-timeout-'))
  try {
    const dshHome = path.join(root, 'dsh')
    const storageRoot = path.join(root, 'storage')
    const scriptsDir = path.join(root, 'scripts')
    mkdirSync(dshHome, { recursive: true })
    mkdirSync(storageRoot, { recursive: true })
    mkdirSync(scriptsDir, { recursive: true })
    writeExecutable(path.join(scriptsDir, 'hang.sh'), `#!/usr/bin/env node
const cmd = process.argv[2]
if (cmd === 'name') { process.stdout.write('hang'); process.exit(0) }
if (cmd === 'restore-doc') { process.stdout.write('# hang\\n'); process.exit(0) }
if (cmd === 'copy') { setInterval(() => {}, 1000) }
`)

    const ctx = new Context()
    installScriptsHook(ctx, { scriptsDir, commandTimeoutMs: 2000 })
    const driver = createLocalDriver(normalizeEntry({ id: 'st-0001', type: 'local', options: { root: storageRoot } }, 0))
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 0.2, ignore: ['test'], include: [], credentialRef: 'X' }

    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 30 })
    assert.equal(result.code, 'BACKUP_TIMEOUT')
    assert.equal(result.details.sections[0].outcome, 'timeout')
    assert.ok(result.details.killed.length > 0, 'copy child pid killed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('self-backup includes the scripts directory contents', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-self-scripts-'))
  try {
    const scriptsDir = path.join(root, 'scripts')
    mkdirSync(scriptsDir, { recursive: true })
    writeExecutable(path.join(scriptsDir, 'db.sh'), '#!/bin/sh\necho db\n')
    writeFileSync(path.join(scriptsDir, 'not-exec'), 'x')

    const workspace = new BackupWorkspace(path.join(root, 'ws'))
    mkdirSync(workspace.root, { recursive: true })
    const dir = prepareSelfSection(workspace, { providers: [], backups: [], scriptsDir })
    const copied = path.join(dir, 'scripts', 'db.sh')
    assert.equal(readFileSync(copied, 'utf8'), '#!/bin/sh\necho db\n')
    assert.ok((statSync(copied).mode & 0o111) !== 0, 'executable mode preserved')
    assert.deepEqual(readdirSync(path.join(dir, 'scripts')), ['db.sh'], 'non-executable file skipped')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
