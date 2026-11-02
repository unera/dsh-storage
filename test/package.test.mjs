import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))

/** Every module the package imports from itself must be shipped with it. */
test('every relative import of index.mjs is listed in package.json files', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  const shipped = new Set(manifest.files ?? [])
  const source = await readFile(join(root, 'index.mjs'), 'utf8')
  const relatives = [...source.matchAll(/from\s+'(\.\/[^']+)'/g)].map(match => match[1].replace('./', ''))
  assert.notEqual(relatives.length, 0, 'index.mjs is expected to import its drivers')
  for (const relative of relatives) {
    assert.equal(shipped.has(relative), true, `${relative} is imported but not in files — the installed plugin will fail to import`)
  }
})

test('the client bundle is shipped next to the host half', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.files.includes('client.js'), true)
  assert.notEqual(manifest.dsh?.client, undefined, 'the client half advertises itself through dsh.client')
})
