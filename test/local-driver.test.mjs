import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createLocalDriver, normalizeEntry, readAll, KEEP_FILE } from '../index.mjs'

async function withStorage(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-'))
  try {
    const entry = normalizeEntry({ id: 'st-0001', type: 'local', label: 'tmp', options: { root } }, 0)
    await run({ root, entry, driver: createLocalDriver(entry) })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('write then read returns the same bytes', async () => {
  await withStorage(async ({ root, driver }) => {
    const written = await driver.put('docs/note.txt', 'привет')
    assert.equal(written.key, 'docs/note.txt')
    assert.equal(written.size, Buffer.byteLength('привет'))
    const text = (await readAll(await driver.get('docs/note.txt'))).toString('utf8')
    assert.equal(text, 'привет')
    assert.equal(await readFile(path.join(root, 'docs/note.txt'), 'utf8'), 'привет')
  })
})

test('a write leaves no .part file behind', async () => {
  await withStorage(async ({ root, driver }) => {
    await driver.put('a.txt', 'x')
    const info = await stat(path.join(root, 'a.txt'))
    assert.equal(info.isFile(), true)
    await assert.rejects(stat(path.join(root, 'a.txt.part')))
  })
})

test('list reports files and directories, never the keep marker', async () => {
  await withStorage(async ({ driver }) => {
    await driver.mkdir('docs')
    await driver.put('docs/a.txt', 'a')
    await driver.put('docs/b.txt', 'b')
    const { items } = await driver.list('docs')
    assert.deepEqual(items.map(item => item.key).sort(), ['docs/a.txt', 'docs/b.txt'])
    assert.equal(items.every(item => item.type === 'file'), true)
  })
})

test('list honours the limit and says it truncated', async () => {
  await withStorage(async ({ driver }) => {
    for (const name of ['a', 'b', 'c']) await driver.put(`f/${name}.txt`, name)
    const { items, truncated } = await driver.list('f', { limit: 2 })
    assert.equal(items.length, 2)
    assert.equal(truncated, true)
  })
})

test('mkdir creates the directory and a keep marker', async () => {
  await withStorage(async ({ driver, root }) => {
    const result = await driver.mkdir('empty')
    assert.equal(result.created, true)
    assert.equal(result.medium, 'directory')
    const marker = await stat(path.join(root, 'empty', KEEP_FILE))
    assert.equal(marker.isFile(), true)
    const { items } = await driver.list('empty')
    assert.deepEqual(items, [])
  })
})

test('stat says nothing about a missing key instead of throwing', async () => {
  await withStorage(async ({ driver }) => {
    assert.equal(await driver.stat('nope.txt'), undefined)
  })
})

test('deleting a directory needs recursive', async () => {
  await withStorage(async ({ driver }) => {
    await driver.put('dir/a.txt', 'a')
    await assert.rejects(driver.delete('dir'), /pass recursive/)
    const result = await driver.delete('dir', { recursive: true })
    assert.equal(result.deleted, true)
  })
})

test('a read-only entry refuses writes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'dsh-storage-ro-'))
  try {
    const entry = normalizeEntry({ id: 'st-0002', type: 'local', readOnly: true, options: { root } }, 0)
    const driver = createLocalDriver(entry)
    await assert.rejects(driver.put('x.txt', 'x'), /read-only/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('upload and download a whole file', async () => {
  await withStorage(async ({ driver, root }) => {
    const local = path.join(root, 'source.bin')
    await writeFile(local, Buffer.alloc(1024, 7))
    const uploaded = await driver.putFile('files/source.bin', local)
    assert.equal(uploaded.size, 1024)
    assert.match(uploaded.sha256, /^[0-9a-f]{64}$/)
    const target = path.join(root, 'copy.bin')
    const downloaded = await driver.getFile('files/source.bin', target)
    assert.equal(downloaded.size, 1024)
    assert.equal((await stat(target)).isFile(), true)
  })
})

test('the probe test reports ok on a writable directory', async () => {
  await withStorage(async ({ driver }) => {
    const result = await driver.test()
    assert.equal(result.state, 'ok')
  })
})

test('free space is a number or null, never a lie', async () => {
  await withStorage(async ({ driver }) => {
    const { freeBytes } = await driver.free()
    assert.equal(typeof freeBytes === 'number' || freeBytes === null, true)
  })
})
