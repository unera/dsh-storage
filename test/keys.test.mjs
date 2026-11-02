import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeKey, normalizeBasePath, resolveInside, FilestoreError } from '../index.mjs'

test('a plain key passes through', () => {
  assert.equal(normalizeKey('docs/readme.md'), 'docs/readme.md')
})

test('a leading slash is dropped, backslashes become slashes', () => {
  assert.equal(normalizeKey('/docs/readme.md'), 'docs/readme.md')
  assert.equal(normalizeKey('docs\\readme.md'), 'docs/readme.md')
})

test('an empty key is the storage root', () => {
  assert.equal(normalizeKey(''), '')
  assert.equal(normalizeKey(undefined), '')
  assert.equal(normalizeKey(null), '')
})

test('a traversal segment is refused', () => {
  for (const bad of ['..', '../etc/passwd', 'a/../../b', './x', 'a/./b']) {
    assert.throws(() => normalizeKey(bad), (error) => error instanceof FilestoreError && error.code === 'FILESTORE_BAD_KEY', bad)
  }
})

test('NUL and empty segments are refused', () => {
  assert.throws(() => normalizeKey('a\0b'), /NUL/)
  assert.throws(() => normalizeKey('a//b'), /empty segment/)
})

test('an over-long key is refused', () => {
  assert.throws(() => normalizeKey('a'.repeat(1025)), /longer than 1024/)
})

test('a non-string key is refused', () => {
  assert.throws(() => normalizeKey(42), /must be a string/)
})

test('a base path is a relative posix path', () => {
  assert.equal(normalizeBasePath(''), '')
  assert.equal(normalizeBasePath('/dsh/backups/'), 'dsh/backups')
  assert.equal(normalizeBasePath('a\\b'), 'a/b')
  assert.throws(() => normalizeBasePath('a/../b'), /cannot contain/)
})

test('resolveInside keeps every key under the root', () => {
  assert.equal(resolveInside('/srv/data', 'a/b'), '/srv/data/a/b')
  assert.equal(resolveInside('/srv/data', ''), '/srv/data')
  assert.throws(() => resolveInside('/srv/data', '../outside'), FilestoreError)
})
