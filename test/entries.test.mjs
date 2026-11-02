import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeEntry, normalizeEntries, makeEntryId, makeCredentialRef, PROVIDER_TYPES } from '../index.mjs'

test('ids are positional and stable in shape', () => {
  assert.equal(makeEntryId(0), 'st-0001')
  assert.equal(makeEntryId(41), 'st-0042')
})

test('a credential reference derives from the entry id', () => {
  assert.match(String(makeCredentialRef('st-0001')), /DSH_FILESTORE_ST_0001/)
})

test('an entry gets defaults and keeps its id', () => {
  const entry = normalizeEntry({ id: 'st-0007', type: 'local', options: { root: '/srv/data' } }, 0)
  assert.equal(entry.id, 'st-0007')
  assert.equal(entry.enabled, true)
  assert.equal(entry.role, 'secondary')
  assert.equal(entry.basePath, '')
  assert.equal(entry.options.root, '/srv/data')
})

test('an unknown type is dropped instead of carried around', () => {
  assert.equal(normalizeEntry({ type: 'dropbox' }, 0), undefined)
  assert.deepEqual(normalizeEntries([{ type: 'dropbox' }, { type: 'local', id: 'st-0002' }]).entries.map(entry => entry.id), ['st-0002'])
})

test('only the first primary keeps the flag', () => {
  const { entries, demoted } = normalizeEntries([
    { id: 'st-0001', type: 'local', role: 'primary' },
    { id: 'st-0002', type: 'local', role: 'primary' },
    { id: 'st-0003', type: 'local', role: 'primary' },
  ])
  assert.deepEqual(entries.map(entry => entry.role), ['primary', 'secondary', 'secondary'])
  assert.deepEqual(demoted, ['st-0002', 'st-0003'])
})

test('a disabled entry stays in the list', () => {
  const { entries } = normalizeEntries([{ id: 'st-0001', type: 'local', enabled: false }])
  assert.equal(entries[0].enabled, false)
})

test('every supported type survives normalization', () => {
  for (const type of PROVIDER_TYPES) {
    assert.notEqual(normalizeEntry({ type }, 0), undefined, type)
  }
})

test('a bad base path is refused at normalization time', () => {
  assert.throws(() => normalizeEntries([{ id: 'st-0001', type: 'local', basePath: '../escape' }]), /cannot contain/)
})

test('the providers field is volatile, or the host cannot save settings', async () => {
  const { Config } = await import('../index.mjs')
  // dsh-settings persists only fields under a volatile node; without the mark
  // every settings write throws and takes the host process down with it.
  const providers = Config.dict?.providers
  assert.notEqual(providers, undefined, 'providers must stay in the config schema')
  assert.equal(providers.meta?.volatile, true, 'providers must be marked volatile()')
})
