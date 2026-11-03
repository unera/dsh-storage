import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { apply, SETTINGS_NAMESPACE } from '../index.mjs'
import {
  SELF_SECTION_NAME, collectCredentialRefs, credentialsDocument, finalizeSelfSection, prepareSelfSection,
  providerClientRef, resolveCredentialRefs, sanitizeConfigDocument, RESTORE_MD,
} from '../selfbackup.mjs'
import { BackupWorkspace, readSectionStatus } from '../backup.mjs'

test('providerClientRef derives the OAuth app-secret reference', () => {
  assert.equal(providerClientRef('st-0001'), 'DSH_FILESTORE_ST_0001_CLIENT')
})

test('collectCredentialRefs gathers provider token, client secret and backup key, deduped', () => {
  const providers = [{ id: 'st-0001', credentialRef: 'DSH_FILESTORE_ST_0001' }]
  const backups = [{ id: 'bk-0001', credentialRef: 'DSH_FILESTORE_BACKUP_BK_0001_KEY' }]
  const refs = collectCredentialRefs(providers, backups)
  assert.deepEqual(refs.sort(), [
    'DSH_FILESTORE_BACKUP_BK_0001_KEY',
    'DSH_FILESTORE_ST_0001',
    'DSH_FILESTORE_ST_0001_CLIENT',
  ])
  // The backup key ref is collected only once even if a provider repeats it.
  const dup = collectCredentialRefs(providers, [{ id: 'bk-0001', credentialRef: 'DSH_FILESTORE_ST_0001' }])
  assert.equal(dup.length, 2)
})

test('sanitizeConfigDocument keeps providers and backups but drops the non-persisted known flag', () => {
  const document = sanitizeConfigDocument(
    [{ id: 'st-0001', type: 'local', label: 'tmp', credentialRef: 'DSH_FILESTORE_ST_0001', options: { root: '/srv' } }],
    [{ id: 'bk-0001', name: 'daily', known: true, providerId: 'st-0001', credentialRef: 'DSH_FILESTORE_BACKUP_BK_0001_KEY', rotation: 10 }],
  )
  assert.equal(document.providers[0].credentialRef, 'DSH_FILESTORE_ST_0001')
  assert.equal(document.providers[0].secret, undefined)
  assert.equal(document.backups[0].known, undefined)
  assert.equal(document.backups[0].key, undefined)
  assert.equal(document.backups[0].credentialRef, 'DSH_FILESTORE_BACKUP_BK_0001_KEY')
})

test('resolveCredentialRefs only keeps resolvable references with their source', async () => {
  const store = {
    resolve: async ref => (ref === 'DSH_FILESTORE_ST_0001' ? { value: 'token-abc', source: 'file' } : undefined),
  }
  const references = await resolveCredentialRefs(store, ['DSH_FILESTORE_ST_0001', 'DSH_FILESTORE_ST_0001_CLIENT'])
  assert.deepEqual(references, { DSH_FILESTORE_ST_0001: { source: 'file', value: 'token-abc' } })
})

test('prepareSelfSection creates the section with UTF-8 config.json and RESTORE.md', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-self-'))
  try {
    const workspace = new BackupWorkspace(root)
    const dir = prepareSelfSection(workspace, {
      providers: [{ id: 'st-0001', type: 'local', credentialRef: 'DSH_FILESTORE_ST_0001', options: { root: '/srv' } }],
      backups: [{ id: 'bk-0001', name: 'daily', providerId: 'st-0001', credentialRef: 'DSH_FILESTORE_BACKUP_BK_0001_KEY' }],
    })
    assert.equal(dir, path.join(root, SELF_SECTION_NAME))
    const config = JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8'))
    assert.equal(config.providers[0].id, 'st-0001')
    assert.equal(config.backups[0].name, 'daily')
    const restore = readFileSync(path.join(dir, 'RESTORE.md'), 'utf8')
    assert.match(restore, /dsh-storage/)
    assert.match(restore, /ctx\.credentials\.set/)
    assert.doesNotMatch(restore, /DSH_FILESTORE_BACKUP_BK_0001_KEY/, 'no key value belongs in the open RESTORE.md')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('finalizeSelfSection writes credentials.json and marks status ok', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-self-'))
  try {
    const providers = [{ id: 'st-0001', type: 'local', credentialRef: 'DSH_FILESTORE_ST_0001', options: { root: '/srv' } }]
    const backups = [{ id: 'bk-0001', name: 'daily', providerId: 'st-0001', credentialRef: 'DSH_FILESTORE_BACKUP_BK_0001_KEY' }]
    const workspace = new BackupWorkspace(root)
    const dir = prepareSelfSection(workspace, { providers, backups })
    const store = {
      resolve: async ref => (ref === 'DSH_FILESTORE_BACKUP_BK_0001_KEY' ? { value: 'c2VjcmV0', source: 'file' } : undefined),
    }
    await finalizeSelfSection(dir, { store, providers, backups })
    const creds = JSON.parse(readFileSync(path.join(dir, 'credentials.json'), 'utf8'))
    assert.deepEqual(creds.references, { DSH_FILESTORE_BACKUP_BK_0001_KEY: { source: 'file', value: 'c2VjcmV0' } })
    const status = readSectionStatus(dir)
    assert.equal(status.status, 'ok')
    assert.ok(typeof status.updatedAt === 'string')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('RESTORE_MD is UTF-8 text and carries no secret placeholders beyond the passphrase prompt', () => {
  assert.equal(typeof RESTORE_MD, 'string')
  assert.match(RESTORE_MD, /Установка/)
  assert.match(RESTORE_MD, /Распаковка/)
  assert.doesNotMatch(RESTORE_MD, /topsecret|secret-key-value/)
})

/** Boot the plugin like the host would, with a stateful credentials store. */
async function boot({ providers = [], credentials = {} } = {}) {
  const ctx = new Context()
  const record = { tools: [], routes: [], configured: [], document: { providers }, secrets: [] }
  const credMap = new Map(Object.entries(credentials))
  ctx.provide('tools', { register: tool => record.tools.push(tool) })
  ctx.provide('systemPrompt', {
    section: section => { record.sections = [...(record.sections ?? []), section]; return () => {} },
    getSectionOrder: () => 100,
  })
  ctx.provide('settings', {
    configure: options => record.configured.push(options),
    describe: () => [{ ns: SETTINGS_NAMESPACE, value: record.document }],
    update: async (ns, value) => { record.document = { ...record.document, ...value } },
  })
  ctx.provide('connection', { fetch: { register: route => { record.routes.push(route); return async () => {} } } })
  ctx.provide('credentials', {
    resolve: async ref => (credMap.has(ref) ? { value: credMap.get(ref), source: 'file' } : undefined),
    set: async (ref, value) => { credMap.set(ref, value); record.secrets.push([ref, value]) },
    describe: async ref => ({ configured: credMap.has(ref) }),
  })
  apply(ctx, {})
  for (let attempt = 0; attempt < 50 && record.routes.length === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  await new Promise(resolve => setTimeout(resolve, 10))
  return { ctx, record }
}

async function callApi(record, target) {
  const spec = typeof target === 'string' ? { path: target } : target
  const route = record.routes.find(item => item.path === spec.path)
  if (route === undefined) throw new Error(`no route ${spec.path}`)
  const verb = spec.method ?? (spec.body === undefined ? 'GET' : 'POST')
  const request = new Request(`https://dsh.example${spec.path}`, {
    method: verb,
    headers: { 'content-type': 'application/json' },
    body: verb === 'POST' ? JSON.stringify(spec.body ?? {}) : undefined,
  })
  const response = await route.fetch(request)
  const text = await response.text()
  return { status: response.status, body: text === '' ? undefined : JSON.parse(text) }
}

test('a real backup run captures dsh-storage.cfg with config, credentials and status', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-self-e2e-'))
  try {
    const storageRoot = path.join(root, 'storage')
    mkdirSync(storageRoot, { recursive: true })
    const { ctx, record } = await boot({
      providers: [{ id: 'st-0001', type: 'local', label: 'tmp', role: 'primary', options: { root: storageRoot } }],
      credentials: { DSH_FILESTORE_ST_0001: 'token-abc' },
    })
    try {
      // A backup with an encryption key, so the archive is encrypted and the key
      // must show up (base64) in the captured credentials, not in RESTORE.md.
      const saved = await callApi(record, {
        method: 'POST',
        path: '/api/filestore/backups/save',
        body: { name: 'daily', providerId: 'st-0001', directory: 'bk', key: '  topsecret  ' },
      })
      assert.equal(saved.status, 201)

      const run = await callApi(record, { method: 'POST', path: '/api/filestore/backups/run', body: { id: 'bk-0001' } })
      assert.equal(run.body.code, 'ok')

      // Outer archive is a plain tar; the section payload is gpg+zstd inside it.
      const archive = readdirSync(path.join(storageRoot, 'bk')).find(name => name.endsWith('.tar'))
      assert.ok(archive, 'a plain .tar container was uploaded')
      const archivePath = path.join(storageRoot, 'bk', archive)

      const openMember = name => execFileSync('tar', ['-xOf', archivePath, `sections/dsh-storage.cfg/${name}`], { encoding: 'utf8' })

      const payload = execFileSync('tar', ['-xOf', archivePath, 'sections/dsh-storage.cfg/payload.tar.zst.gpg'])
      const dec = execFileSync('gpg', ['--batch', '--yes', '--pinentry-mode', 'loopback', '--passphrase', 'topsecret', '-d'], { input: payload })
      const tarBytes = execFileSync('zstd', ['-dc'], { input: dec })
      const payloadMember = name => execFileSync('tar', ['-xOf', '-', name], { input: tarBytes, encoding: 'utf8' })

      const config = JSON.parse(payloadMember('config.json'))
      assert.equal(config.providers[0].id, 'st-0001')
      assert.equal(config.providers[0].secret, undefined)
      assert.equal(config.backups[0].name, 'daily')
      assert.equal(config.backups[0].key, undefined)

      const creds = JSON.parse(payloadMember('credentials.json'))
      assert.equal(creds.references.DSH_FILESTORE_ST_0001.value, 'token-abc')
      assert.equal(creds.references.DSH_FILESTORE_BACKUP_BK_0001_KEY.value, Buffer.from('topsecret', 'utf8').toString('base64'))
      assert.equal(creds.references.DSH_FILESTORE_ST_0001_CLIENT, undefined)

      const restore = openMember('RESTORE.md')
      assert.match(restore, /Установка/)
      assert.doesNotMatch(restore, /topsecret/, 'RESTORE.md must not contain the key')
      assert.doesNotMatch(restore, /dG9wc2VjcmV0/, 'RESTORE.md must not contain the base64 key')
    } finally {
      await ctx.stop?.()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the refresh-sections API runs prepare only and persists the discovered list', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-self-refresh-'))
  try {
    const storageRoot = path.join(root, 'storage')
    mkdirSync(storageRoot, { recursive: true })
    const { ctx, record } = await boot({ providers: [{ id: 'st-0001', type: 'local', label: 'tmp', role: 'primary', options: { root: storageRoot } }] })
    try {
      const saved = await callApi(record, { method: 'POST', path: '/api/filestore/backups/save', body: { name: 'daily', providerId: 'st-0001' } })
      assert.equal(saved.status, 201)
      const refreshed = await callApi(record, { method: 'POST', path: '/api/filestore/backups/sections', body: { id: 'bk-0001' } })
      assert.equal(refreshed.status, 200)
      assert.ok(refreshed.body.sections.includes('dsh-storage.cfg'), 'the plugin discovers its own section')
      assert.deepEqual(record.document.backups[0].sections, refreshed.body.sections)
    } finally {
      await ctx.stop?.()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
