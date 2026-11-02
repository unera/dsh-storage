import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { DICTIONARIES, NS } from './locales.js'

const SECTION_ID = 'storage'
const API = '/__fs'

const styles = {
  intro: { opacity: 0.75, margin: '0 0 16px', lineHeight: 1.5 },
  table: { width: '100%', borderCollapse: 'collapse', marginBottom: 16 },
  th: { textAlign: 'left', padding: '6px 8px', opacity: 0.7, fontWeight: 600, borderBottom: '1px solid rgba(128,128,128,0.3)' },
  td: { padding: '8px', borderBottom: '1px solid rgba(128,128,128,0.15)', verticalAlign: 'top' },
  badge: { display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 12, background: 'rgba(128,128,128,0.2)', marginRight: 6 },
  ok: { background: 'rgba(60,180,90,0.25)' },
  bad: { background: 'rgba(220,80,70,0.25)' },
  button: { marginRight: 6, marginTop: 2, padding: '3px 8px', cursor: 'pointer' },
  form: { border: '1px solid rgba(128,128,128,0.3)', borderRadius: 8, padding: 12, marginTop: 8 },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220, flex: '1 1 220px' },
  input: { padding: '5px 7px' },
  hint: { opacity: 0.6, fontSize: 12 },
  error: { color: '#d05a4e', margin: '8px 0' },
  note: { opacity: 0.7, fontSize: 12, marginTop: 8 },
}

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  const body = text === '' ? {} : JSON.parse(text)
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
  return body
}

function bytes(value) {
  if (typeof value !== 'number') return null
  const units = ['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

/** One row of the storages table. */
function StorageRow({ provider, t, onTest, onPrimary, onRemove, busy }) {
  const stateTone = provider.status?.state === 'ok' ? styles.ok : provider.status?.state === 'unknown' ? {} : styles.bad
  const free = bytes(provider.status?.freeBytes)
  return jsx('tr', {
    children: [
      jsx('td', { style: styles.td, children: [
        jsx('strong', { children: provider.label }),
        jsx('div', { style: styles.hint, children: `${provider.type} · ${provider.id}${provider.basePath === '' ? '' : ` · ${provider.basePath}`}` }),
      ] }),
      jsx('td', { style: styles.td, children: [
        jsx('span', { style: { ...styles.badge, ...stateTone }, children: provider.status?.state ?? 'unknown' }),
        provider.status?.message === undefined ? null : jsx('div', { style: styles.hint, children: provider.status.message }),
        provider.secretConfigured ? jsx('div', { style: styles.hint, children: t('secretSet') }) : null,
      ] }),
      jsx('td', { style: styles.td, children: [
        provider.role === 'primary' ? jsx('span', { style: { ...styles.badge, ...styles.ok }, children: t('primary') }) : null,
        jsx('div', { style: styles.hint, children: free === null ? t('unknownFree') : `${t('free')}: ${free}` }),
      ] }),
      jsx('td', { style: styles.td, children: [
        jsx('button', { style: styles.button, disabled: busy, onClick: () => onTest(provider.id), children: t('test') }),
        provider.role === 'primary' ? null : jsx('button', { style: styles.button, disabled: busy, onClick: () => onPrimary(provider.id), children: t('makePrimary') }),
        jsx('button', { style: styles.button, disabled: busy, onClick: () => onRemove(provider.id), children: t('remove') }),
      ] }),
    ],
  })
}

/** The add form; fields depend on the chosen type. */
function AddForm({ types, t, onCancel, onSaved }) {
  const [type, setType] = useState(types[0] ?? 'local')
  const [label, setLabel] = useState('')
  const [basePath, setBasePath] = useState('')
  const [root, setRoot] = useState('')
  const [bucket, setBucket] = useState('')
  const [region, setRegion] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [secret, setSecret] = useState('')
  const [primary, setPrimary] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const options = type === 'local' ? { root: root.trim() } : { bucket: bucket.trim(), ...(region.trim() === '' ? {} : { region: region.trim() }), ...(endpoint.trim() === '' ? {} : { endpoint: endpoint.trim() }) }
      await request('/providers', {
        method: 'POST',
        body: {
          type,
          label: label.trim() === '' ? undefined : label.trim(),
          basePath: basePath.trim(),
          role: primary ? 'primary' : 'secondary',
          options,
          ...(secret.trim() === '' ? {} : { secret: secret.trim() }),
        },
      })
      await onSaved()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  return jsx('div', { style: styles.form, children: [
    jsx('div', { style: styles.row, children: [
      jsx('label', { style: styles.field, children: [
        jsx('span', { children: t('type') }),
        jsx('select', { style: styles.input, value: type, onChange: event => setType(event.target.value), children: types.map(item => jsx('option', { value: item, children: item }, item)) }),
      ] }),
      jsx('label', { style: styles.field, children: [
        jsx('span', { children: t('label') }),
        jsx('input', { style: styles.input, value: label, placeholder: t('labelPlaceholder'), onChange: event => setLabel(event.target.value) }),
      ] }),
      jsx('label', { style: styles.field, children: [
        jsx('span', { children: t('basePath') }),
        jsx('input', { style: styles.input, value: basePath, onChange: event => setBasePath(event.target.value) }),
        jsx('span', { style: styles.hint, children: t('basePathHint') }),
      ] }),
    ] }),
    type === 'local'
      ? jsx('div', { style: styles.row, children: [
        jsx('label', { style: styles.field, children: [
          jsx('span', { children: t('root') }),
          jsx('input', { style: styles.input, value: root, placeholder: '/srv/data', onChange: event => setRoot(event.target.value) }),
          jsx('span', { style: styles.hint, children: t('rootHint') }),
        ] }),
      ] })
      : jsxs('div', { children: [
        jsx('div', { style: styles.row, children: [
          jsx('label', { style: styles.field, children: [
            jsx('span', { children: t('bucket') }),
            jsx('input', { style: styles.input, value: bucket, onChange: event => setBucket(event.target.value) }),
          ] }),
          jsx('label', { style: styles.field, children: [
            jsx('span', { children: t('region') }),
            jsx('input', { style: styles.input, value: region, placeholder: 'ru-central1', onChange: event => setRegion(event.target.value) }),
          ] }),
          jsx('label', { style: styles.field, children: [
            jsx('span', { children: t('endpoint') }),
            jsx('input', { style: styles.input, value: endpoint, placeholder: 'https://storage.yandexcloud.net', onChange: event => setEndpoint(event.target.value) }),
            jsx('span', { style: styles.hint, children: t('endpointHint') }),
          ] }),
        ] }),
        jsx('label', { style: styles.field, children: [
          jsx('span', { children: t('secret') }),
          jsx('textarea', { style: { ...styles.input, minHeight: 60 }, value: secret, onChange: event => setSecret(event.target.value) }),
          jsx('span', { style: styles.hint, children: t('secretHint') }),
        ] }),
      ] }),
    error === null ? null : jsx('div', { style: styles.error, children: error }),
    jsx('div', { style: { marginTop: 10 }, children: [
      jsx('label', { style: { marginRight: 12 }, children: [
        jsx('input', { type: 'checkbox', checked: primary, onChange: event => setPrimary(event.target.checked) }),
        ` ${t('primary')}`,
      ] }),
      jsx('button', { style: styles.button, disabled: busy, onClick: submit, children: t('save') }),
      jsx('button', { style: styles.button, disabled: busy, onClick: onCancel, children: t('cancel') }),
    ] }),
  ] })
}

/** The settings section itself. */
export function StoragePage(props) {
  const t = typeof props?.t === 'function' ? props.t : key => key
  const [providers, setProviders] = useState([])
  const [types, setTypes] = useState(['local'])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)

  const load = async () => {
    setError(null)
    try {
      const body = await request('/providers')
      setProviders(Array.isArray(body.providers) ? body.providers : [])
      if (Array.isArray(body.types) && body.types.length > 0) setTypes(body.types)
    } catch (problem) {
      setError(problem.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const act = async (run) => {
    setBusy(true)
    setError(null)
    try {
      await run()
      await load()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  const indexOf = id => providers.findIndex(provider => provider.id === id)

  return jsx('div', { children: [
    jsx('p', { style: styles.intro, children: t('intro') }),
    loading ? jsx('p', { style: styles.hint, children: t('loading') }) : null,
    error === null ? null : jsx('div', { style: styles.error, children: error }),
    providers.length === 0 && !loading ? jsx('p', { style: styles.hint, children: t('empty') }) : null,
    providers.length === 0 ? null : jsx('table', { style: styles.table, children: [
      jsx('thead', { children: jsx('tr', { children: [
        jsx('th', { style: styles.th, children: t('label') }),
        jsx('th', { style: styles.th, children: t('type') }),
        jsx('th', { style: styles.th, children: '' }),
        jsx('th', { style: styles.th, children: '' }),
      ] }) }),
      jsx('tbody', { children: providers.map(provider => jsx(StorageRow, {
        provider,
        t,
        busy,
        onTest: id => act(async () => { await request(`/providers/${indexOf(id)}/test`, { method: 'POST' }) }),
        onPrimary: id => act(async () => { await request(`/providers/${indexOf(id)}/primary`, { method: 'POST' }) }),
        onRemove: id => act(async () => {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('confirmRemove'))) return
          await request(`/providers/${indexOf(id)}`, { method: 'DELETE' })
        }),
      }, provider.id)) }),
    ] }),
    adding
      ? jsx(AddForm, { types, t, onCancel: () => setAdding(false), onSaved: async () => { setAdding(false); await load() } })
      : jsx('button', { style: styles.button, disabled: busy || loading, onClick: () => setAdding(true), children: t('add') }),
    jsx('p', { style: styles.note, children: 'API: /__fs' }),
  ] })
}

/** Client entry: dictionaries first, then the settings section. */
export function apply(ctx) {
  let t = key => key
  try {
    t = ctx.locale.bind(NS)
  } catch (error) {
    console.warn(`[dsh-storage] locale unavailable: ${error?.message ?? error}`)
  }

  try {
    ctx.effect(() => {
      ctx.locale.register(NS, 'en', DICTIONARIES.en)
      ctx.locale.register(NS, 'ru', DICTIONARIES.ru)
      return () => {}
    }, 'dsh-storage: dictionaries')
  } catch (error) {
    console.warn(`[dsh-storage] dictionaries failed: ${error?.message ?? error}`)
  }

  // Another plugin may have registered `ru` first; a duplicate must not take
  // this page down with it.
  try {
    ctx.effect(() => {
      try {
        return ctx.locale.addLanguage('ru')
      } catch (error) {
        if (!/already/i.test(String(error?.message ?? error))) throw error
        return () => {}
      }
    }, 'dsh-storage: ru language')
  } catch (error) {
    console.warn(`[dsh-storage] ru language failed: ${error?.message ?? error}`)
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: 36,
    locale: NS,
    label: () => t('nav.title'),
  }, StoragePage))
}

export const inject = ['slots', 'locale']
