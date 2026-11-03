import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply, SETTINGS_NAMESPACE } from '../index.mjs'
import { BackupWorkspace, discoverSections, readSectionStatus, runBackup } from '../backup.mjs'
import { TEST_SECTION_NAME, installTestHook, prepareTestSection, spawnTestChild } from '../testhook.mjs'
import { createLocalDriver, normalizeEntry } from '../index.mjs'

test('prepareTestSection creates the test section with a marker and RESTORE.md', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-testhook-'))
  try {
    const dir = prepareTestSection(new BackupWorkspace(root))
    assert.equal(dir, path.join(root, TEST_SECTION_NAME))
    assert.equal(readFileSync(path.join(dir, 'marker.txt'), 'utf8'), 'dsh-storage backup test participant\n')
    assert.match(readFileSync(path.join(dir, 'RESTORE.md'), 'utf8'), /diagnostic|диагности/)
    assert.doesNotMatch(readFileSync(path.join(dir, 'RESTORE.md'), 'utf8'), /status\.json[\s\S]*pids/, 'no secrets in the open RESTORE.md')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('spawnTestChild writes status ok after the duration and exits without SIGKILL', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-testhook-'))
  try {
    const dir = prepareTestSection(new BackupWorkspace(root))
    const child = spawnTestChild(dir, 300)
    assert.ok(Number.isInteger(child.pid) && child.pid > 0)
    const exited = await new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
    assert.equal(exited.code, 0)
    assert.equal(exited.signal, null, 'a successful child must not be SIGKILLed')
    const status = readSectionStatus(dir)
    assert.equal(status.status, 'ok')
    assert.deepEqual(status.pids, [])
    assert.ok(typeof status.updatedAt === 'string')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('installTestHook drives a real backup: prepare, backup-start child, polling to ok', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-testhook-'))
  try {
    const dshHome = path.join(root, 'dsh')
    const storageRoot = path.join(root, 'storage')
    mkdirSync(dshHome, { recursive: true })
    mkdirSync(storageRoot, { recursive: true })
    const driver = createLocalDriver(normalizeEntry({ id: 'st-0001', type: 'local', options: { root: storageRoot } }, 0))

    const ctx = new Context()
    installTestHook(ctx, { durationMs: 300 })

    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: [], include: [], credentialRef: 'X' }
    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 50 })
    assert.equal(result.code, 'ok')
    const outcomes = result.details.sections.map(item => [item.name, item.outcome])
    assert.deepEqual(outcomes, [[TEST_SECTION_NAME, 'ok']], 'the test section completes ok')
    assert.ok(result.details.discovered.includes(TEST_SECTION_NAME))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('apply installs the test participant by default: discoverSections includes test', async () => {
  const ctx = new Context()
  ctx.provide('tools', { register: () => {} })
  ctx.provide('systemPrompt', { section: () => () => {}, getSectionOrder: () => 100 })
  ctx.provide('settings', {
    configure: () => {},
    describe: () => [{ ns: SETTINGS_NAMESPACE, value: { providers: [] } }],
    update: async () => {},
  })
  ctx.provide('connection', { fetch: { register: () => async () => {} } })
  ctx.provide('credentials', { resolve: async () => undefined, set: async () => {}, describe: async () => ({ configured: false }) })
  apply(ctx, {})

  const dshHome = mkdtempSync(path.join(tmpdir(), 'dsh-testhook-apply-'))
  try {
    const sections = await discoverSections(ctx, { dshHome })
    assert.ok(sections.includes('dsh-storage.cfg'), 'self-backup section present')
    assert.ok(sections.includes(TEST_SECTION_NAME), 'test participant section is always on')
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})
