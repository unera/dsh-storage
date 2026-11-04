import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

test('Found section items render their name as children, not as a positional third arg', async () => {
  const source = await readFile(join(root, 'client', 'index.jsx'), 'utf8')
  // The jsx runtime's third argument is the key slot, not children: a section
  // item must place the name in `children`, never as `}, name))`.
  assert.match(source, /sections\.map\(name => jsx\('div', \{\s*key: name,/)
  assert.match(source, /children: name/)
  assert.doesNotMatch(source, /},\s*name\)\)/)
})

test('the built client bundle carries the children render', async () => {
  const bundle = await readFile(join(root, 'client.js'), 'utf8')
  assert.match(bundle, /children: name/)
})
