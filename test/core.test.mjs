import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { BackupWorkspace, runBackup } from '../backup.mjs'
import {
  CORE_SECTION_NAME, buildCoreManifest, finalizeCoreSection, installCoreHook, prepareCoreSection, storeRefNames,
} from '../core.mjs'
import { createLocalDriver, normalizeEntry } from '../index.mjs'

function makeProfile(dshHome, name, pkg, extraFiles = {}) {
  const dir = path.join(dshHome, 'profiles', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg), 'utf8')
  for (const [file, body] of Object.entries(extraFiles)) writeFileSync(path.join(dir, file), body, 'utf8')
}

test('buildCoreManifest captures profile packages and bundles, secret-free', () => {
  const dshHome = mkdtempSync(path.join(tmpdir(), 'dsh-core-manifest-'))
  try {
    makeProfile(dshHome, 'web', {
      name: 'dsh-profile-web',
      dependencies: { '@dr-co/dsh-storage': 'file:/x/dsh-storage-0.2.17.tgz', '@deepseek-ai/dsh-web': '0.2.1-rc.4' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@dr-co/dsh-storage'] } },
    })
    const manifest = buildCoreManifest(dshHome)
    assert.equal(manifest.profiles[0].name, 'web')
    assert.equal(manifest.profiles[0].dependencies['@dr-co/dsh-storage'], 'file:/x/dsh-storage-0.2.17.tgz')
    assert.deepEqual(manifest.profiles[0].bundles, ['@deepseek-ai/dsh-base', '@dr-co/dsh-storage'])
    // No secret-bearing fields are expected in the manifest.
    assert.equal(JSON.stringify(manifest).includes('credential'), false)
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('storeRefNames extracts only the refs map keys', () => {
  const dshHome = mkdtempSync(path.join(tmpdir(), 'dsh-core-refs-'))
  try {
    writeFileSync(path.join(dshHome, '.credentials.yaml'), [
      'version: 1',
      'records:',
      '  client-connection/browser-session:',
      '    kind: browser-session',
      '    payload:',
      '      secret: x',
      'refs:',
      '  OPENAI_API_KEY: sk-123',
      '  MISTRAL_API_KEY: k-456',
      '',
    ].join('\n'), 'utf8')
    assert.deepEqual(storeRefNames(dshHome).sort(), ['MISTRAL_API_KEY', 'OPENAI_API_KEY'])
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('prepareCoreSection writes manifest, profile files and RESTORE.md', () => {
  const dshHome = mkdtempSync(path.join(tmpdir(), 'dsh-core-prepare-'))
  try {
    makeProfile(dshHome, 'web', { name: 'dsh-profile-web', dependencies: {}, dsh: { profile: { bundles: [] } } }, { 'pnpm-lock.yaml': 'lockfileVersion: 9.0\n' })
    const workspace = new BackupWorkspace(path.join(dshHome, 'ws'))
    mkdirSync(workspace.root, { recursive: true })
    const dir = prepareCoreSection(workspace, { dshHomeDir: dshHome })
    assert.equal(path.basename(dir), CORE_SECTION_NAME)
    assert.ok(JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')).profiles.length === 1)
    assert.equal(readFileSync(path.join(dir, 'profiles', 'web', 'pnpm-lock.yaml'), 'utf8'), 'lockfileVersion: 9.0\n')
    assert.match(readFileSync(path.join(dir, 'RESTORE.md'), 'utf8'), /Установка DSH/)
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('finalizeCoreSection writes records and refs from the credentials API', async () => {
  const dshHome = mkdtempSync(path.join(tmpdir(), 'dsh-core-finalize-'))
  try {
    writeFileSync(path.join(dshHome, '.credentials.yaml'), 'refs:\n  OPENAI_API_KEY: sk-123\n', 'utf8')
    const dir = path.join(dshHome, 'core')
    mkdirSync(dir, { recursive: true })
    const store = {
      async listRecords() { return [{ key: 'client-connection/browser-session', kind: 'browser-session' }] },
      async readRecord(key) { return { key, kind: 'browser-session', payload: { secret: 's3' } } },
      async resolve(ref) { return ref === 'OPENAI_API_KEY' ? { value: 'sk-123', source: 'file' } : undefined },
      async set() {}, async describe() { return { configured: false } },
    }
    await finalizeCoreSection(dir, { dshHomeDir: dshHome, store })
    const credentials = JSON.parse(readFileSync(path.join(dir, 'credentials.json'), 'utf8'))
    assert.equal(credentials.records[0].key, 'client-connection/browser-session')
    assert.equal(credentials.refs.OPENAI_API_KEY.value, 'sk-123')
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'status.json'), 'utf8')).status, 'ok')
  } finally {
    rmSync(dshHome, { recursive: true, force: true })
  }
})

test('installCoreHook adds a core section to a real backup run', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-core-run-'))
  try {
    const dshHome = path.join(root, 'dsh')
    const storageRoot = path.join(root, 'storage')
    mkdirSync(dshHome, { recursive: true })
    mkdirSync(storageRoot, { recursive: true })
    makeProfile(dshHome, 'web', { name: 'dsh-profile-web', dependencies: {}, dsh: { profile: { bundles: [] } } })

    const ctx = new Context()
    ctx.provide('credentials', { resolve: async () => undefined, set: async () => {}, describe: async () => ({ configured: false }) })
    installCoreHook(ctx, { dshHomeDir: dshHome })
    const driver = createLocalDriver(normalizeEntry({ id: 'st-0001', type: 'local', options: { root: storageRoot } }, 0))
    const entry = { id: 'bk-0001', name: 'daily', providerId: 'st-0001', directory: 'bk', rotation: 2, timeoutSeconds: 5, ignore: [], include: ['core'], credentialRef: 'X' }

    const result = await runBackup(ctx, entry, { driver: () => driver }, async () => undefined, { dshHome, pollIntervalMs: 30 })
    assert.equal(result.code, 'ok')
    assert.ok(result.details.discovered.includes(CORE_SECTION_NAME), 'core section discovered')
    assert.equal(result.details.sections.find(item => item.name === CORE_SECTION_NAME).outcome, 'ok')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
