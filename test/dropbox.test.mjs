import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDropboxDriver, parseDropboxCredentials } from '../dropbox.mjs'

function response(status, body) {
  return { status, ok: status >= 200 && status < 300, text: async () => JSON.stringify(body), json: async () => body, body: null }
}

test('Dropbox credentials accept a bare token or refresh JSON', () => {
  assert.deepEqual(parseDropboxCredentials('abc'), { accessToken: 'abc' })
  assert.deepEqual(parseDropboxCredentials('{"refresh_token":"ref"}'), { refreshToken: 'ref' })
})

test('Dropbox refreshes an offline token before listing', async () => {
  const calls = []
  const fetchFn = async (url, options) => {
    calls.push({ url, options })
    if (url.includes('/oauth2/token')) return response(200, { access_token: 'access', expires_in: 3600 })
    if (url.endsWith('/files/list_folder')) return response(200, { entries: [{ '.tag': 'file', name: 'hello.txt', size: 4, server_modified: '2026-01-01T00:00:00Z' }], has_more: false })
    throw new Error(`unexpected URL ${url}`)
  }
  const driver = createDropboxDriver({ id: 'st-db01', type: 'dropbox', basePath: '', options: { clientId: 'app-key' } }, {
    resolveSecret: async () => JSON.stringify({ refreshToken: 'refresh' }),
    resolveClientSecret: async () => 'app-secret',
    fetchFn,
  })
  const listed = await driver.list('')
  assert.equal(listed.items[0].key, 'hello.txt')
  assert.equal(calls[0].url, 'https://api.dropboxapi.com/oauth2/token')
  assert.match(String(calls[0].options.body), /grant_type=refresh_token/)
  assert.equal(calls[1].url, 'https://api.dropboxapi.com/2/files/list_folder')
})
