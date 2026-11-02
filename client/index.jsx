import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { DICTIONARIES, NS } from './locales.js'

const SECTION_ID = 'storage'
const API = '/__fs'

/** Type ids are for the API; a person reads these. */
const TYPE_LABELS = {
  local: 'Каталог на этом хосте',
  s3: 'S3-совместимый',
  webdav: 'WebDAV',
  yadisk: 'Яндекс.Диск',
}

/** Inline SVG marks, so the panel never fetches an image from outside. */
const ICONS = {
  local: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#8aa0b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>'),
  s3: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#e0a23c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></svg>'),
  webdav: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#5aa9e6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 18a4 4 0 0 0 .6-8A6 6 0 0 0 6 11a3.5 3.5 0 0 0 .5 7z"/></svg>'),
  yadisk: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="6" fill="#fc3f1d"/><path d="M9 18V9.2c0-2 1.3-3.2 3.3-3.2H15v2.4h-2.2c-.8 0-1.2.4-1.2 1.2V11l3.6 7h-2.7l-3-6v6z" fill="#fff"/></svg>'),
  edit: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16z"/></svg>'),
  save: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l5 5L20 6"/></svg>'),
  cancel: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'),
  test: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.3-5.7"/><path d="M20 4v4h-4"/></svg>'),
  primary: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.9 5.9 6.1.9-4.4 4.3 1 6.4-5.6-3-5.6 3 1-6.4L3 9.8l6.1-.9z"/></svg>'),
  remove: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>'),
}

const styles = {
  intro: { opacity: 0.75, margin: '0 0 16px', lineHeight: 1.5 },
  table: { width: '100%', borderCollapse: 'collapse', marginBottom: 16 },
  th: { textAlign: 'left', padding: '6px 8px', opacity: 0.7, fontWeight: 600, borderBottom: '1px solid rgba(128,128,128,0.3)' },
  td: { padding: '8px', borderBottom: '1px solid rgba(128,128,128,0.15)', verticalAlign: 'top' },
  badge: { display: 'inline-block', padding: '1px 6px', borderRadius: 4, fontSize: 12, background: 'rgba(128,128,128,0.2)', marginRight: 6 },
  ok: { background: 'rgba(60,180,90,0.25)' },
  bad: { background: 'rgba(220,80,70,0.25)' },
  button: { marginRight: 6, marginTop: 2, padding: '3px 8px', cursor: 'pointer' },
  square: { width: 28, height: 28, padding: 0, marginRight: 4, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', borderRadius: 6 },
  icon: { width: 16, height: 16, display: 'block' },
  typeIcon: { width: 22, height: 22, marginRight: 8, flex: '0 0 auto' },
  nameCell: { display: 'flex', alignItems: 'flex-start', gap: 12 },
  badges: { display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', maxWidth: 190 },
  buttonColumn: { display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' },
  iconColumn: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: '0 0 auto' },
  // The primary mark doubles as the switch: a star that is grey until the entry
  // is the default target, and green once it is.
  starPill: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 18, padding: 0, borderRadius: 9, border: 'none' },
  starOn: { background: 'rgba(60,180,90,0.45)' },
  starOff: { background: 'rgba(128,128,128,0.25)' },
  // No `cursor: help`: a question-mark pointer on a small pill reads as a puzzle
  // rather than as a tooltip, and the hint appears on hover anyway.
  pill: { display: 'inline-block', padding: '1px 7px', borderRadius: 10, fontSize: 12, whiteSpace: 'nowrap' },
  pillOk: { background: 'rgba(60,180,90,0.28)' },
  pillGrey: { background: 'rgba(128,128,128,0.28)' },
  pillBad: { background: 'rgba(220,80,70,0.28)' },
  pillFree: { background: 'rgba(70,130,220,0.30)' },
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
/** One square, icon-only button; the word lives in the tooltip. */
function IconButton({ icon, title, onClick, disabled, tone }) {
  return jsx('button', {
    style: { ...styles.square, ...(tone === undefined ? {} : tone) },
    title,
    'aria-label': title,
    disabled,
    onClick,
    children: jsx('img', { src: ICONS[icon], alt: '', style: styles.icon }),
  })
}

/** A pill; `tone` picks the colour, `hint` is the tooltip. */
function Pill({ children, tone, hint }) {
  return jsx('span', { style: { ...styles.pill, ...tone }, title: hint, children })
}

/**
 * One storage row. The type column and the state column are merged on purpose:
 * everything smaller than the name fits into one strip of pills, so the name and
 * its type keep the width.
 */
function StorageRow({ provider, capabilities, t, onTest, onPrimary, onRemove, onEdit, busy }) {
  const state = provider.status?.state ?? 'unknown'
  const stateTone = state === 'ok' ? styles.pillOk : state === 'unknown' ? styles.pillGrey : styles.pillBad
  const stateHint = state === 'unknown'
    ? t('hintUnknownState')
    : provider.status?.message ?? state
  const caps = capabilities?.[provider.type] ?? {}
  const free = bytes(provider.status?.freeBytes)
  const permission = (letter, allowed, hint) => jsx(Pill, { tone: allowed ? styles.pillOk : styles.pillBad, hint, children: letter })

  return jsx('tr', {
    children: [
      jsx('td', { style: styles.td, children: jsx('div', { style: styles.nameCell, children: [
        jsx('div', { style: styles.iconColumn, children: [
          jsx('img', { src: ICONS[provider.type], alt: '', style: { ...styles.typeIcon, marginRight: 0 } }),
          jsx('button', {
            style: { ...styles.starPill, ...(provider.role === 'primary' ? styles.starOn : styles.starOff), cursor: provider.role === 'primary' ? 'default' : 'pointer' },
            title: provider.role === 'primary' ? t('primary') : t('makePrimary'),
            'aria-label': provider.role === 'primary' ? t('primary') : t('makePrimary'),
            disabled: busy || provider.role === 'primary',
            onClick: () => onPrimary(provider.id),
            children: jsx('img', { src: ICONS.primary, alt: '', style: { width: 12, height: 12, display: 'block' } }),
          }),
        ] }),
        jsx('div', { children: [
          jsx('strong', { children: provider.label }),
          jsx('div', { style: styles.hint, children: `${TYPE_LABELS[provider.type] ?? provider.type} · ${provider.id}${provider.role === 'primary' ? ` · ${t('primary')}` : ''}` }),
          provider.options?.root === undefined ? null : jsx('div', { style: styles.hint, children: provider.options.root }),
          provider.options?.baseUrl === undefined ? null : jsx('div', { style: styles.hint, children: provider.options.baseUrl }),
          provider.options?.bucket === undefined ? null : jsx('div', { style: styles.hint, children: `${provider.options.bucket}${provider.options.endpoint === undefined ? '' : ` · ${provider.options.endpoint}`}` }),
        ] }),
      ] }) }),
      jsx('td', { style: styles.td, children: jsx('div', { style: styles.badges, children: [
        jsx(Pill, { tone: stateTone, hint: stateHint, children: state === 'unknown' ? '?' : state }),
        permission('R', caps.get === true, t('hintRead')),
        permission('W', caps.put === true, t('hintWrite')),
        permission('D', caps.delete === true, t('hintDelete')),
        free === null
          ? jsx(Pill, { tone: styles.pillGrey, hint: t('hintFreeUnknown'), children: '—' })
          : jsx(Pill, { tone: styles.pillFree, hint: t('hintFree'), children: free }),
      ] }) }),
      jsx('td', { style: { ...styles.td, whiteSpace: 'nowrap', verticalAlign: 'top' }, children: jsx('div', { style: styles.buttonColumn, children: [
        jsx(IconButton, { icon: 'edit', title: t('edit'),
          disabled: busy, onClick: () => onEdit(provider.id) }),
        jsx(IconButton, { icon: 'test', title: t('test'),
          disabled: busy, onClick: () => onTest(provider.id) }),
        jsx(IconButton, { icon: 'remove', title: t('remove'),
          disabled: busy, onClick: () => onRemove(provider.id) }),
      ] }) }),
    ],
  })
}

/**
 * The entry form. With `initial` it edits an existing storage (PATCH), without it
 * it creates a new one (POST). The fields depend on the type, and the type itself
 * cannot change while editing: an existing entry keeps its driver.
 */
function EntryForm({ types, t, first, initial, onCancel, onSaved }) {
  const editing = initial !== undefined
  // One id per form, allocated on open and sent with the save: a token taken by
  // the device handshake before saving then lands on this very entry.
  const [entryId] = useState(() => initial?.id ?? `st-${Math.random().toString(36).slice(2, 6)}`)
  const [type, setType] = useState(initial?.type ?? types[0] ?? 'local')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [basePath, setBasePath] = useState(initial?.basePath ?? '')
  const [root, setRoot] = useState(initial?.options?.root ?? '')
  const [bucket, setBucket] = useState(initial?.options?.bucket ?? '')
  const [region, setRegion] = useState(initial?.options?.region ?? '')
  const [endpoint, setEndpoint] = useState(initial?.options?.endpoint ?? '')
  const [baseUrl, setBaseUrl] = useState(initial?.options?.baseUrl ?? '')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [clientId, setClientId] = useState(initial?.options?.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [token, setToken] = useState('')
  const [device, setDevice] = useState(null)
  const [deviceState, setDeviceState] = useState(null)
  const [secret, setSecret] = useState('')
  const [enabled, setEnabled] = useState(initial?.enabled !== false)
  const [readOnly, setReadOnly] = useState(initial?.readOnly === true)
  // A lone storage must be primary, otherwise every tool call without an explicit
  // id fails with "no storage is marked primary" and the user has no idea why.
  const autoPrimary = first === true
  const [primary, setPrimary] = useState(initial?.role === 'primary' || first === true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const optionsFor = () => {
    if (type === 'local') return { root: root.trim() }
    if (type === 'webdav') return { baseUrl: baseUrl.trim() }
    if (type === 'yadisk') return { ...(clientId.trim() === '' ? {} : { clientId: clientId.trim() }) }
    return { bucket: bucket.trim(), ...(region.trim() === '' ? {} : { region: region.trim() }), ...(endpoint.trim() === '' ? {} : { endpoint: endpoint.trim() }) }
  }

  /**
   * The secret depends on the driver: two fields for WebDAV, a token for Yandex,
   * a JSON blob for S3. An empty secret means "keep what is stored".
   */
  const secretFor = () => {
    if (type === 'webdav') {
      if (username.trim() === '' && password.trim() === '') return undefined
      return JSON.stringify({ username: username.trim(), password: password.trim() })
    }
    if (type === 'yadisk') return token.trim() === '' ? undefined : token.trim()
    return secret.trim() === '' ? undefined : secret.trim()
  }

  // The device flow lives on a saved entry: the host needs an entry to attach the
  // token to and a client id to name. Say so instead of leaving a dead button.
  // Always clickable: a dead button cannot explain itself, and a click that says
  // "fill the application id first" teaches more than a grey rectangle.
  const deviceReady = true
  const deviceBlockedReason = clientId.trim() === '' ? t('clientIdNeeded') : ''

  /**
   * Device flow: ask the host for a user code, show it, then poll the host until
   * the provider says the code was confirmed. The token never passes through the
   * page — it goes straight into the credential store on the host.
   */
  const startDevice = async () => {
    setError(null)
    if (clientId.trim() === '') {
      setError(t('clientIdNeeded'))
      return
    }
    // Opened here, while the click is still the user's gesture: a window opened
    // after an await is a popup and gets blocked. It is pointed at the device page
    // once the code arrives.
    const popup = typeof window !== 'undefined' ? window.open('about:blank', '_blank') : null
    try {
      const started = await request('/auth/device/start', { method: 'POST', body: { id: entryId, clientId: clientId.trim(), type } })
      if (popup !== null && popup.closed !== true) popup.location.href = started.verificationUrl
      else if (typeof window !== 'undefined') window.open(started.verificationUrl, '_blank', 'noopener')
      setDeviceState(started.state)
      setDevice({ userCode: started.userCode, verificationUrl: started.verificationUrl, status: 'waiting' })
      const intervalMs = Math.max(1000, Number(started.interval ?? 5) * 1000)
      const deadline = Date.now() + Math.max(30, Number(started.expiresIn ?? 300)) * 1000
      const poll = async () => {
        if (Date.now() > deadline) {
          setDevice(current => current === null ? null : { ...current, status: 'error', error: 'код истёк' })
          return
        }
        try {
          const answer = await request('/auth/device/poll', { method: 'POST', body: { state: started.state } })
          if (answer.status === 'ok') {
            setDevice(current => current === null ? null : { ...current, status: 'ok' })
            setToken('')
            // The token lives on the host and is never printed. Re-read the list so
            // the row shows that a secret is configured.
            await load()
            return
          }
          if (answer.status === 'pending') {
            setTimeout(poll, intervalMs)
            return
          }
          setDevice(current => current === null ? null : { ...current, status: 'error', error: answer.error ?? answer.status })
        } catch (problem) {
          setDevice(current => current === null ? null : { ...current, status: 'error', error: problem.message })
        }
      }
      setTimeout(poll, intervalMs)
    } catch (problem) {
      if (popup !== null && popup.closed !== true) popup.close()
      setError(problem.message)
    }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const payload = {
        label: label.trim(),
        basePath: basePath.trim(),
        role: primary || autoPrimary ? 'primary' : 'secondary',
        enabled,
        readOnly,
        options: optionsFor(),
        ...(secretFor() === undefined ? {} : { secret: secretFor() }),
        ...(clientSecret.trim() === '' ? {} : { clientSecret: clientSecret.trim() }),
      }
      if (editing) await request(`/providers/${initial.index}`, { method: 'PATCH', body: payload })
      else await request('/providers', { method: 'POST', body: { ...payload, type, id: entryId } })
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
        jsx('select', { style: styles.input, value: type, disabled: editing, onChange: event => setType(event.target.value), children: types.map(item => jsx('option', { value: item, children: TYPE_LABELS[item] ?? item }, item)) }),
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
      : type === 'webdav'
      ? jsxs('div', { children: [
        jsx('div', { style: styles.row, children: [
          jsx('label', { style: styles.field, children: [
            jsx('span', { children: 'baseUrl' }),
            jsx('input', { style: styles.input, value: baseUrl, placeholder: 'https://cloud.example/remote.php/dav/files/user', onChange: event => setBaseUrl(event.target.value) }),
          ] }),
        ] }),
        jsx('div', { style: styles.row, children: [
          jsx('label', { style: styles.field, children: [
            jsx('span', { children: t('login') }),
            jsx('input', { style: styles.input, value: username, autoComplete: 'off', onChange: event => setUsername(event.target.value) }),
          ] }),
          jsx('label', { style: styles.field, children: [
            jsx('span', { children: t('password') }),
            jsx('input', { style: styles.input, type: 'password', value: password, autoComplete: 'new-password', onChange: event => setPassword(event.target.value) }),
            jsx('span', { style: styles.hint, children: editing ? t('secretKeep') : t('passwordHint') }),
          ] }),
        ] }),
      ] })
      : type === 'yadisk'
      ? jsxs('div', { children: [
        jsx('div', { style: styles.row, children: [
          jsx('label', { style: styles.field, children: [
            jsx('span', { children: t('clientId') }),
            jsx('input', { style: styles.input, value: clientId, placeholder: 'идентификатор приложения', onChange: event => setClientId(event.target.value) }),
            jsx('span', { style: styles.hint, children: t('clientIdHint') }),
          ] }),
          jsx('label', { style: styles.field, children: [
            jsx('span', { children: t('clientSecret') }),
            jsx('input', { style: styles.input, type: 'password', value: clientSecret, autoComplete: 'new-password', onChange: event => setClientSecret(event.target.value) }),
            jsx('span', { style: styles.hint, children: editing ? t('secretKeep') : t('clientSecretHint') }),
          ] }),
        ] }),
        jsx('div', { style: { margin: '4px 0 12px' }, children: [
          jsx('button', {
            style: styles.button,
            disabled: busy || !deviceReady || device?.status === 'waiting',
            title: deviceReady ? t('deviceConnect') : deviceBlockedReason,
            onClick: startDevice,
            children: t('deviceConnect'),
          }),
          // Why the button does nothing, in words instead of a tooltip: a greyed
          // button with a hidden reason reads as broken.
          deviceReady ? null : jsx('div', { style: { ...styles.hint, marginTop: 4 }, children: deviceBlockedReason }),
          device === null ? null : jsx('div', { style: { marginTop: 8 }, children: [
            jsx('div', { children: [t('deviceCode'), ': ', jsx('strong', { style: { fontSize: 18, letterSpacing: 2 }, children: device.userCode })] }),
            jsx('div', { style: { ...styles.hint, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }, children: [
              t('deviceOpen'),
              jsx('a', { href: device.verificationUrl, target: '_blank', rel: 'noreferrer', children: device.verificationUrl }),
              jsx('button', { style: styles.button, onClick: () => window.open(device.verificationUrl, '_blank', 'noopener'), children: t('deviceOpenButton') }),
            ] }),
            jsx('div', { style: styles.hint, children: device.status === 'ok' ? t('deviceDone') : device.status === 'error' ? `${t('failed')}: ${device.error}` : t('deviceWaiting') }),
          ] }),
        ] }),
        jsx('label', { style: styles.field, children: [
          jsx('span', { children: t('token') }),
          jsx('textarea', { style: { ...styles.input, minHeight: 60 }, value: token, onChange: event => setToken(event.target.value) }),
          jsx('span', { style: styles.hint, children: editing ? t('secretKeep') : t('tokenHint') }),
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
          jsx('span', { style: styles.hint, children: editing ? t('secretKeep') : t('secretHint') }),
        ] }),
      ] }),
    error === null ? null : jsx('div', { style: styles.error, children: error }),
    jsx('div', { style: { marginTop: 10 }, children: [
      jsx('label', { style: { marginRight: 12 }, children: [
        jsx('input', { type: 'checkbox', checked: primary || autoPrimary, disabled: autoPrimary, onChange: event => setPrimary(event.target.checked) }),
        ` ${t('primary')}`,
      ] }),
      jsx('label', { style: { marginRight: 12 }, children: [
        jsx('input', { type: 'checkbox', checked: enabled, onChange: event => setEnabled(event.target.checked) }),
        ` ${t('enabledLabel')}`,
      ] }),
      jsx('label', { style: { marginRight: 12 }, children: [
        jsx('input', { type: 'checkbox', checked: readOnly, onChange: event => setReadOnly(event.target.checked) }),
        ` ${t('readOnlyLabel')}`,
      ] }),
    ] }),
    jsx('div', { style: { marginTop: 12, display: 'flex', gap: 8 }, children: [
      jsx('button', { style: styles.button, disabled: busy, onClick: submit, children: [
        jsx('img', { src: ICONS.save, alt: '', style: { ...styles.icon, display: 'inline-block', verticalAlign: '-3px', marginRight: 6 } }),
        t('save'),
      ] }),
      jsx('button', { style: styles.button, disabled: busy, onClick: onCancel, children: [
        jsx('img', { src: ICONS.cancel, alt: '', style: { ...styles.icon, display: 'inline-block', verticalAlign: '-3px', marginRight: 6 } }),
        t('cancel'),
      ] }),
    ] }),
  ] })
}

/** The settings section itself. */
export function StoragePage(props) {
  const t = typeof props?.t === 'function' ? props.t : key => key
  const [providers, setProviders] = useState([])
  const [types, setTypes] = useState(['local'])
  const [capabilities, setCapabilities] = useState({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)

  /** Read the list without painting it: a stale read must not roll the panel back. */
  const peek = async () => {
    const body = await request('/providers')
    const next = Array.isArray(body.providers) ? body.providers : []
    if (Array.isArray(body.types) && body.types.length > 0) setTypes(body.types)
    if (body.capabilities !== undefined && body.capabilities !== null) setCapabilities(body.capabilities)
    return next
  }

  const fetchOnce = async () => {
    const next = await peek()
    setProviders(next)
    return next
  }

  const load = async () => {
    setError(null)
    try {
      await fetchOnce()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setLoading(false)
    }
  }

  /**
   * After a write the settings document lands a moment later, so one immediate
   * read can still see the old list. Retry briefly instead of showing a stale
   * panel to someone who just pressed Save.
   */
  const reloadAfterWrite = async (expectedAtLeast) => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const next = await fetchOnce()
        if (next.length >= expectedAtLeast) return
      } catch {
        // keep trying; a real failure surfaces on the next read
      }
      await new Promise(resolve => setTimeout(resolve, 150))
    }
  }

  useEffect(() => { load() }, [])

  /**
   * Run a mutation, then read repeatedly until the server reports the state the
   * mutation was supposed to produce, and only then paint it. Painting every read
   * is what made the star jump: an early read still carried the old document, the
   * panel accepted it, and the switch appeared to undo itself before redoing.
   */
  const act = async (run, { optimistic, until } = {}) => {
    if (typeof optimistic === 'function') setProviders(previous => optimistic(previous))
    setBusy(true)
    setError(null)
    try {
      await run()
      let last
      for (let attempt = 0; attempt < 30; attempt += 1) {
        last = await peek()
        if (until === undefined || until(last) === true) {
          setProviders(last)
          return
        }
        await new Promise(resolve => setTimeout(resolve, 150))
      }
      // Never leave the panel showing a guess: after the patience runs out, the
      // server wins even if it disagrees with the optimistic paint.
      if (last !== undefined) setProviders(last)
    } catch (problem) {
      setError(problem.message)
      await load()
    } finally {
      setBusy(false)
    }
  }

  const indexOf = id => providers.findIndex(provider => provider.id === id)
  /** The form showing right now: a new entry, or an existing one being edited. */
  const form = adding
    ? { key: 'new' }
    : editingId === null
      ? null
      : (() => {
        const provider = providers.find(item => item.id === editingId)
        return provider === undefined ? null : { key: provider.id, initial: { ...provider, index: providers.indexOf(provider) } }
      })()

  return jsx('div', { children: [
    jsx('p', { style: styles.intro, children: t('intro') }),
    loading ? jsx('p', { style: styles.hint, children: t('loading') }) : null,
    error === null ? null : jsx('div', { style: styles.error, children: error }),
    form === null
      ? jsx('button', { style: styles.button, disabled: busy || loading, onClick: () => { setAdding(true); setEditingId(null) }, children: t('add') })
      : jsx(EntryForm, {
        key: form.key,
        types,
        t,
        first: providers.length === 0 && form.initial === undefined,
        initial: form.initial,
        onCancel: () => { setAdding(false); setEditingId(null) },
        onSaved: async () => {
          const wasEditing = form.initial !== undefined
          setAdding(false)
          setEditingId(null)
          await reloadAfterWrite(wasEditing ? providers.length : providers.length + 1)
        },
      }),
    providers.length === 0 && !loading ? jsx('p', { style: styles.hint, children: t('empty') }) : null,
    providers.length === 0 ? null : jsx('table', { style: styles.table, children: [
      jsx('thead', { children: jsx('tr', { children: [
        jsx('th', { style: { ...styles.th, width: '100%' }, children: t('label') }),
        jsx('th', { style: { ...styles.th, whiteSpace: 'nowrap' }, children: '' }),
        jsx('th', { style: { ...styles.th, whiteSpace: 'nowrap' }, children: '' }),
      ] }) }),
      jsx('tbody', { children: providers.map(provider => jsx(StorageRow, {
        provider,
        capabilities,
        t,
        busy,
        onTest: id => {
          const before = providers.find(item => item.id === id)?.status?.checkedAt ?? null
          return act(
            async () => { await request(`/providers/${indexOf(id)}/test`, { method: 'POST' }) },
            { until: next => (next.find(item => item.id === id)?.status?.checkedAt ?? null) !== before },
          )
        },
        onPrimary: id => act(
          async () => { await request(`/providers/${indexOf(id)}/primary`, { method: 'POST' }) },
          {
            // Show the switch immediately; the loop only waits for confirmation.
            optimistic: previous => previous.map(item => ({ ...item, role: item.id === id ? 'primary' : 'secondary' })),
            until: next => next.find(item => item.id === id)?.role === 'primary',
          },
        ),
        onEdit: id => { setEditingId(id); setAdding(false) },
        onRemove: id => {
          if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('confirmRemove'))) return
          return act(
            async () => { await request(`/providers/${indexOf(id)}`, { method: 'DELETE' }) },
            {
              optimistic: previous => previous.filter(item => item.id !== id),
              until: next => next.every(item => item.id !== id),
            },
          )
        },
      }, provider.id)) }),
    ] }),
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

  // `addLanguage` takes a registration object, not a tag: a bare 'ru' leaves
  // `id` undefined and throws "locale id \"undefined\" is not a BCP 47-style tag".
  // Another plugin may have registered `ru` first, and a duplicate must not take
  // this page down with it.
  try {
    ctx.effect(() => {
      try {
        return ctx.locale.addLanguage({ id: 'ru', label: 'Русский', fallback: 'en' })
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
