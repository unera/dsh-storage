import { useEffect, useRef, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { DICTIONARIES, NS } from './locales.js'

const SECTION_ID = 'storage'
// Under /api, where the host admits only an authenticated owner — the same gate
// the settings pages sit behind.
const API = '/api/filestore'

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
  copy: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/></svg>'),
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
  spinner: {
    display: 'inline-block',
    width: 10,
    height: 10,
    border: '2px solid rgba(200,200,200,0.45)',
    borderTopColor: 'rgba(240,240,240,0.95)',
    borderRadius: '50%',
    animation: 'dsh-storage-spin 0.9s linear infinite',
  },
  form: { border: '1px solid rgba(128,128,128,0.3)', borderRadius: 8, padding: 12, marginTop: 8 },
  row: { display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 },
  field: { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220, flex: '1 1 220px' },
  input: { padding: '5px 7px' },
  hint: { opacity: 0.6, fontSize: 12 },
  error: { color: '#d05a4e', margin: '8px 0' },
  note: { opacity: 0.7, fontSize: 12, marginTop: 8 },
}

// One shared keyframes block for the spinner: inline styles cannot declare
// @keyframes, so every page that renders `styles.spinner` must mount this once.
const SPIN_KEYFRAMES = '@keyframes dsh-storage-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }'

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  const body = text === '' ? {} : JSON.parse(text)
  if (!response.ok) throw new Error(body?.error ?? body?.message ?? `HTTP ${response.status}`)
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
/**
 * A one-line field built on `textarea`. Password managers key off `input` with
 * a password type or an autocomplete hint and keep offering to fill these in;
 * a textarea with rows=1 takes the same text and stays out of their way.
 */
function LineField({ value, onChange, placeholder, spellCheck = false }) {
  return jsx('textarea', {
    rows: 1,
    value,
    placeholder,
    spellCheck,
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'off',
    'data-lpignore': 'true',
    'data-1p-ignore': 'true',
    onChange: event => onChange(event.target.value),
    style: { ...styles.input, height: 30, minHeight: 30, resize: 'none', overflow: 'hidden', whiteSpace: 'pre', fontFamily: 'inherit' },
  })
}

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
function StorageRow({ provider, capabilities, t, onTest, onPrimary, onRemove, onEdit, busy, checking }) {
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
      jsx('td', { style: { ...styles.td, minWidth: 150, verticalAlign: 'top' }, children: jsx('div', { style: styles.badges, children: [
        // While a check runs the pill becomes a spinner: a still "?" cannot tell
        // "not checked yet" from "being checked right now".
        checking
          ? jsx(Pill, { tone: styles.pillGrey, hint: t('checking'), children: jsx('span', { style: styles.spinner }) })
          : jsx(Pill, { tone: stateTone, hint: stateHint, children: state === 'unknown' ? '?' : state }),
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
function EntryForm({ types, t, first, initial, onCancel, onSaved, onRefresh }) {
  // The form sits above a list that is often longer than the screen, so opening it
  // scrolled off-view looked like nothing happened.
  const rootRef = useRef(null)
  useEffect(() => {
    rootRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [])
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
  const [copied, setCopied] = useState(false)

  /** Put the user code on the clipboard; the page may forbid it, so say nothing if it fails. */
  const copyCode = async value => {
    try {
      if (navigator?.clipboard?.writeText !== undefined) await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
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
    try {
      const started = await request('/device/start', {
        method: 'POST',
        // The secret goes with the handshake: an unsaved entry has nowhere to keep
        // it otherwise, and Yandex answers "Wrong client secret".
        body: { id: entryId, clientId: clientId.trim(), type, ...(clientSecret.trim() === '' ? {} : { clientSecret: clientSecret.trim() }) },
      })
      setDevice({ userCode: started.userCode, verificationUrl: started.verificationUrl, status: 'waiting' })
      const intervalMs = Math.max(1000, Number(started.interval ?? 5) * 1000)
      const deadline = Date.now() + Math.max(30, Number(started.expiresIn ?? 300)) * 1000
      const poll = async () => {
        if (Date.now() > deadline) {
          setDevice(current => current === null ? null : { ...current, status: 'error', error: 'код истёк' })
          return
        }
        try {
          const answer = await request('/device/poll', { method: 'POST', body: { state: started.state } })
          if (answer.status === 'ok') {
            setDevice(current => current === null ? null : { ...current, status: 'ok' })
            setToken('')
            // The token lives on the host and is never printed. Re-read the list so
            // the row shows that a token is configured; `load` belongs to the page,
            // so it arrives as a prop.
            if (typeof onRefresh === 'function') await onRefresh()
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
      // One endpoint saves both ways: an id in the body means "update".
      await request('/providers/save', { method: 'POST', body: { ...payload, type, id: entryId } })
      await onSaved()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  return jsx('div', { ref: rootRef, style: styles.form, children: [
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
            jsx(LineField, { value: clientId, placeholder: 'идентификатор приложения', onChange: setClientId }),
            jsx('span', { style: styles.hint, children: t('clientIdHint') }),
          ] }),
          jsx('label', { style: styles.field, children: [
            jsx('span', { children: t('clientSecret') }),
            jsx(LineField, { value: clientSecret, onChange: setClientSecret }),
            jsx('span', { style: styles.hint, children: editing ? t('secretKeep') : t('clientSecretHint') }),
          ] }),
        ] }),
        jsx('div', { style: { margin: '4px 0 12px' }, children: [
          jsx('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }, children: [
            jsx('button', {
              style: styles.button,
              disabled: busy || !deviceReady || device?.status === 'waiting',
              title: deviceReady ? t('deviceConnect') : deviceBlockedReason,
              onClick: startDevice,
              children: t('deviceConnect'),
            }),
            device === null ? null : jsx('strong', { style: { fontSize: 20, letterSpacing: 3, fontFamily: 'monospace' }, children: device.userCode }),
            device === null ? null : jsx(IconButton, {
              icon: 'copy',
              title: t('deviceCopy'),
              onClick: () => copyCode(device.userCode),
            }),
            device === null ? null : jsx('span', { style: styles.hint, children: copied ? t('deviceCopied') : '' }),
            // The instruction rides the same line and is pushed to the right edge;
            // short wording keeps it there on a narrow panel.
            device === null ? null : jsx('span', { style: { marginLeft: 'auto', fontSize: 15 }, children: [
              `${t('deviceOpen')} `,
              jsx('a', { href: device.verificationUrl, target: '_blank', rel: 'noreferrer', children: t('deviceOpenLink') }),
            ] }),
          ] }),
          // Why the button does nothing, in words instead of a tooltip: a greyed
          // button with a hidden reason reads as broken.
          deviceReady ? null : jsx('div', { style: { ...styles.hint, marginTop: 4 }, children: deviceBlockedReason }),

          device === null ? null : jsx('div', { style: { ...styles.hint, marginTop: 6 }, children: device.status === 'ok'
            ? (editing ? t('deviceDone') : t('deviceDoneUnsaved'))
            : device.status === 'error' ? `${t('failed')}: ${device.error}` : t('deviceWaiting') }),
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
  const [checkingId, setCheckingId] = useState(null)

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
        onRefresh: load,
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
      // One keyframes block for the spinner; inline styles cannot declare them.
      jsx('style', { children: SPIN_KEYFRAMES }),
      jsx('tbody', { children: providers.map(provider => jsx(StorageRow, {
        provider,
        capabilities,
        t,
        busy,
        checking: checkingId === provider.id,
        onTest: id => {
          const before = providers.find(item => item.id === id)?.status?.checkedAt ?? null
          setCheckingId(id)
          return act(
            async () => { await request('/providers/test', { method: 'POST', body: { id } }) },
            { until: next => (next.find(item => item.id === id)?.status?.checkedAt ?? null) !== before },
          ).finally(() => setCheckingId(null))
        },
        onPrimary: id => act(
          async () => { await request('/providers/primary', { method: 'POST', body: { id } }) },
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
            async () => { await request('/providers/delete', { method: 'POST', body: { id } }) },
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

const BACKUP_SECTION_ID = 'backup'

/** One backup row. */
function BackupRow({ backup, providers, t, onRun, onEdit, onRemove, busy, running, formOpen }) {
  const provider = providers.find(item => item.id === backup.providerId)
  const isRunning = running || backup.running === true
  const lastRun = backup.lastRun
  // While running, only the spinner shows; the error pill appears only for a
  // finished, non-ok attempt, and the ok pill only for a finished ok attempt.
  const lastDone = lastRun != null && !isRunning && lastRun.code !== 'running'
  const lastKind = lastDone ? (lastRun.code === 'ok' ? 'ok' : (lastRun.finishedAt != null ? 'err' : null)) : null
  const lastTone = lastKind === 'ok' ? styles.pillOk : styles.pillBad
  const lastHint = lastDone ? `${lastRun.code}${lastRun.message ? `: ${lastRun.message}` : ''}${lastRun.finishedAt ? ` @ ${lastRun.finishedAt}` : ''}` : ''
  return jsx('tr', {
    children: [
      jsx('td', { style: styles.td, children: [
        jsx('strong', { children: backup.name }),
        jsx('div', { style: styles.hint, children: `${provider?.label ?? backup.providerId} · ${backup.id}` }),
        backup.directory === '' ? null : jsx('div', { style: styles.hint, children: backup.directory }),
      ] }),
      jsx('td', { style: styles.td, children: jsx('div', { style: styles.badges, children: [
        jsx(Pill, { tone: styles.pillGrey, hint: t('backup.rotationHint'), children: `↻ ${backup.rotation}` }),
        backup.keyConfigured ? jsx(Pill, { tone: styles.pillOk, hint: t('backup.keySet'), children: '🔑' }) : null,
        backup.schedule === '' ? null : jsx(Pill, { tone: styles.pillFree, hint: t('backup.schedule'), children: backup.schedule }),
        lastKind == null ? null : jsx(Pill, { tone: lastTone, hint: lastHint, children: lastKind === 'ok' ? t('backup.okShort') : t('backup.errShort') }),
      ] }) }),
      jsx('td', { style: { ...styles.td, whiteSpace: 'nowrap', verticalAlign: 'top' }, children: jsx('div', { style: styles.buttonColumn, children: [
        isRunning
          ? jsx(Pill, { tone: styles.pillGrey, hint: t('backup.running'), children: jsx('span', { style: styles.spinner }) })
          : jsx(IconButton, { icon: 'test', title: t('backup.run'), disabled: busy || formOpen, onClick: () => onRun(backup.id) }),
        jsx(IconButton, { icon: 'edit', title: t('backup.edit'), disabled: busy || isRunning, onClick: () => onEdit(backup.id) }),
        jsx(IconButton, { icon: 'remove', title: t('backup.remove'), disabled: busy || isRunning, onClick: () => onRemove(backup.id) }),
      ] }) }),
    ],
  })
}

/** The backup form: name, provider, directory, rotation, timeout, globs, key. */
function BackupForm({ providers, t, initial, sections, onCancel, onSaved, onRefreshSections }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [providerId, setProviderId] = useState(initial?.providerId ?? providers[0]?.id ?? '')
  const [directory, setDirectory] = useState(initial?.directory ?? '')
  const [rotation, setRotation] = useState(String(initial?.rotation ?? 10))
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(initial?.timeoutSeconds ?? 300))
  const [ignore, setIgnore] = useState((initial?.ignore ?? []).join('\n'))
  const [include, setInclude] = useState((initial?.include ?? []).join('\n'))
  const [key, setKey] = useState('')
  const [schedule, setSchedule] = useState(initial?.schedule ?? '')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dropTarget, setDropTarget] = useState(null)
  const editing = initial !== undefined

  const doRefreshSections = async () => {
    if (!editing || refreshing) return
    setRefreshing(true)
    setError(null)
    try {
      const found = await onRefreshSections?.(initial.id)
      if (!Array.isArray(found)) throw new Error('refresh sections returned no list')
      // The refreshed list arrives via the `sections` prop (BackupPage owns it).
    } catch (problem) {
      setError(problem.message)
    } finally {
      setRefreshing(false)
    }
  }

  const dragSection = name => event => {
    event.dataTransfer.setData('text/plain', name)
    event.dataTransfer.effectAllowed = 'copy'
  }

  const appendSection = (setter, name) => {
    setter(current => (current.trim() === '' ? name : `${current}\n${name}`))
  }

  const dropSection = (target, setter) => event => {
    event.preventDefault()
    const name = String(event.dataTransfer?.getData('text/plain') ?? '').trim()
    setDropTarget(null)
    if (name === '') return
    appendSection(setter, name)
  }

  const dragOver = target => event => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (dropTarget !== target) setDropTarget(target)
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await request('/backups/save', {
        method: 'POST',
        body: {
          ...(editing ? { id: initial.id } : {}),
          name: name.trim(),
          providerId,
          directory: directory.trim(),
          rotation: Number(rotation) || 10,
          timeoutSeconds: Number(timeoutSeconds) || 300,
          ignore: ignore.split('\n').map(item => item.trim()).filter(item => item !== ''),
          include: include.split('\n').map(item => item.trim()).filter(item => item !== ''),
          schedule: schedule.trim(),
          ...(key.trim() === '' ? {} : { key }),
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
        jsx('span', { children: t('backup.name') }),
        jsx('input', { style: styles.input, value: name, placeholder: t('backup.namePlaceholder'), onChange: event => setName(event.target.value) }),
      ] }),
      jsx('label', { style: styles.field, children: [
        jsx('span', { children: t('backup.provider') }),
        jsx('select', { style: styles.input, value: providerId, onChange: event => setProviderId(event.target.value), children: providers.map(item => jsx('option', { value: item.id, children: item.label }, item.id)) }),
      ] }),
      jsx('label', { style: styles.field, children: [
        jsx('span', { children: t('backup.directory') }),
        jsx('input', { style: styles.input, value: directory, placeholder: 'backups', onChange: event => setDirectory(event.target.value) }),
        jsx('span', { style: styles.hint, children: t('backup.directoryHint') }),
      ] }),
    ] }),
    jsx('div', { style: styles.row, children: [
      jsx('label', { style: styles.field, children: [
        jsx('span', { children: t('backup.rotation') }),
        jsx('input', { style: styles.input, type: 'number', min: 0, value: rotation, onChange: event => setRotation(event.target.value) }),
      ] }),
      jsx('label', { style: styles.field, children: [
        jsx('span', { children: t('backup.timeout') }),
        jsx('input', { style: styles.input, type: 'number', min: 1, value: timeoutSeconds, onChange: event => setTimeoutSeconds(event.target.value) }),
        jsx('span', { style: styles.hint, children: t('backup.timeoutHint') }),
      ] }),
      jsx('label', { style: styles.field, children: [
        jsx('span', { children: t('backup.schedule') }),
        jsx('input', { style: styles.input, value: schedule, placeholder: '0 3 * * *', onChange: event => setSchedule(event.target.value) }),
        jsx('span', { style: styles.hint, children: t('backup.scheduleHint') }),
      ] }),
    ] }),
    jsx('div', { style: { display: 'grid', gridTemplateColumns: '35fr 35fr 30fr', gap: 12, marginBottom: 8, alignItems: 'stretch' }, children: [
      jsx('label', {
        style: { ...styles.field, minWidth: 0, ...(dropTarget === 'ignore' ? { outline: '2px dashed #5aa9e6', outlineOffset: 2, borderRadius: 6 } : {}) },
        onDragOver: dragOver('ignore'),
        onDragLeave: () => setDropTarget(current => (current === 'ignore' ? null : current)),
        onDrop: dropSection('ignore', setIgnore),
        children: [
          jsx('span', { style: { whiteSpace: 'nowrap' }, children: t('backup.ignore') }),
          jsx('textarea', { 'aria-label': t('backup.ignore'), style: { ...styles.input, flex: 1, minHeight: 64, minWidth: 0, width: '100%', boxSizing: 'border-box' }, value: ignore, placeholder: 'logs\nnode_modules', onChange: event => setIgnore(event.target.value) }),
          jsx('span', { style: styles.hint, children: t('backup.ignoreHint') }),
        ],
      }),
      jsx('label', {
        style: { ...styles.field, minWidth: 0, ...(dropTarget === 'include' ? { outline: '2px dashed #5aa9e6', outlineOffset: 2, borderRadius: 6 } : {}) },
        onDragOver: dragOver('include'),
        onDragLeave: () => setDropTarget(current => (current === 'include' ? null : current)),
        onDrop: dropSection('include', setInclude),
        children: [
          jsx('span', { style: { whiteSpace: 'nowrap' }, children: t('backup.include') }),
          jsx('textarea', { 'aria-label': t('backup.include'), style: { ...styles.input, flex: 1, minHeight: 64, minWidth: 0, width: '100%', boxSizing: 'border-box' }, value: include, placeholder: 'db\n*', onChange: event => setInclude(event.target.value) }),
          jsx('span', { style: styles.hint, children: t('backup.includeHint') }),
        ],
      }),
      jsx('div', { style: { ...styles.field, minWidth: 0 }, children: [
        jsx('div', { style: { display: 'flex', alignItems: 'center', gap: 8 }, children: [
          jsx('span', { style: { whiteSpace: 'nowrap' }, children: t('backup.found') }),
          jsx('button', {
            style: styles.square,
            title: t('backup.refreshSections'),
            'aria-label': t('backup.refreshSections'),
            disabled: !editing || refreshing,
            onClick: doRefreshSections,
            children: refreshing
              ? jsx('span', { style: styles.spinner })
              : jsx('span', { style: { fontSize: 15, lineHeight: 1 }, children: '↻' }),
          }),
        ] }),
        jsx('div', { style: { ...styles.input, flex: 1, minHeight: 64, minWidth: 0, boxSizing: 'border-box', overflowY: 'auto', background: 'rgba(128,128,128,0.08)' }, children:
          sections.length === 0
            ? jsx('div', { style: styles.hint, children: editing ? t('backup.foundEmpty') : t('backup.saveFirst') })
            : sections.map(name => jsx('div', {
              key: name,
              draggable: true,
              onDragStart: dragSection(name),
              title: `${t('backup.dragHint')}: ${name}`,
              'aria-label': `${t('backup.dragHint')}: ${name}`,
              style: {
                display: 'flex', alignItems: 'center', gap: 6,
                fontSize: 12, lineHeight: 1.5, cursor: 'move',
                padding: '2px 6px', borderRadius: 4, marginBottom: 4,
                border: '1px solid rgba(128,128,128,0.28)',
                background: 'rgba(128,128,128,0.06)',
              },
              children: [
                jsx('span', { 'aria-hidden': true, style: { cursor: 'grab', userSelect: 'none', opacity: 0.55, fontSize: 11, lineHeight: 1 }, children: '⠿' }),
                jsx('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, children: name }),
              ],
            })),
        }),
        jsx('span', { style: styles.hint, children: t('backup.foundHint') }),
      ] }),
    ] }),
    jsx('label', { style: { ...styles.field, marginTop: 8 }, children: [
      jsx('span', { children: t('backup.key') }),
      jsx(LineField, { value: key, onChange: setKey }),
      jsx('span', { style: styles.hint, children: editing ? t('backup.keyKeep') : t('backup.keyHint') }),
    ] }),
    error === null ? null : jsx('div', { style: styles.error, children: error }),
    jsx('div', { style: { marginTop: 12, display: 'flex', gap: 8 }, children: [
      jsx('button', { style: styles.button, disabled: busy || (editing && initial.running === true), onClick: submit, children: [
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

/** The backup settings section. */
export function BackupPage(props) {
  const t = typeof props?.t === 'function' ? props.t : key => key
  const [backups, setBackups] = useState([])
  const [providers, setProviders] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [runningId, setRunningId] = useState(null)
  const [result, setResult] = useState(null)
  const [liveSections, setLiveSections] = useState(null)

  const fetchOnce = async () => {
    const body = await request('/backups')
    const next = Array.isArray(body.backups) ? body.backups : []
    if (Array.isArray(body.providers)) setProviders(body.providers)
    setBackups(next)
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

  useEffect(() => { load() }, [])

  // While any backup is running, refresh the list so the spinner and last-run
  // state come from the backend, not only from the local runningId.
  const hasRunning = backups.some(item => item.running === true)
  useEffect(() => {
    if (!hasRunning) return undefined
    const timer = setInterval(() => { fetchOnce().catch(() => {}) }, 2000)
    return () => clearInterval(timer)
  }, [hasRunning])

  const run = async id => {
    setRunningId(id)
    setResult(null)
    setBusy(true)
    setError(null)
    try {
      setResult(await request('/backups/run', { method: 'POST', body: { id } }))
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
      setRunningId(null)
      await load()
    }
  }

  const remove = async id => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function' && !window.confirm(t('backup.confirmRemove'))) return
    setBusy(true)
    setError(null)
    try {
      await request('/backups/delete', { method: 'POST', body: { id } })
      await load()
    } catch (problem) {
      setError(problem.message)
    } finally {
      setBusy(false)
    }
  }

  const refreshSections = async id => {
    const body = await request('/backups/sections', { method: 'POST', body: { id } })
    if (!Array.isArray(body.sections)) throw new Error('refresh sections returned no list')
    // Drive the form's Found list from this live value, not from the form's
    // local state, so a `load()` re-render can never clobber the fresh response.
    setLiveSections(body.sections)
    // Persist happened on the host; sync the list best-effort.
    await load().catch(() => {})
    return body.sections
  }

  const closeForm = async reload => {
    setAdding(false)
    setEditingId(null)
    setLiveSections(null)
    if (reload) await load()
  }

  const form = adding
    ? { key: 'new' }
    : editingId === null
      ? null
      : (() => {
        const backup = backups.find(item => item.id === editingId)
        return backup === undefined ? null : { key: backup.id, initial: { ...backup } }
      })()

  return jsx('div', { children: [
    jsx('p', { style: styles.intro, children: t('backup.intro') }),
    loading ? jsx('p', { style: styles.hint, children: t('loading') }) : null,
    error === null ? null : jsx('div', { style: styles.error, children: error }),
    result === null ? null : jsx('div', { style: { ...styles.form, marginTop: 0 }, children: [
      jsx('strong', { children: result.code === 'ok' ? t('backup.ok') : t('backup.failed') }),
      jsx('div', { style: styles.hint, children: result.message }),
      ...(Array.isArray(result.details?.sections)
        ? result.details.sections.filter(item => item.outcome !== 'ok').map(item => jsx('div', { key: item.name, style: styles.hint, children: `${item.name}: ${item.message ?? item.outcome}` }))
        : []),
    ] }),
    form === null
      ? jsx('button', { style: styles.button, disabled: busy || loading, onClick: () => { setAdding(true); setEditingId(null) }, children: t('backup.add') })
      : jsx(BackupForm, {
        key: form.key,
        providers,
        t,
        initial: form.initial,
        sections: liveSections ?? form.initial?.sections ?? [],
        onRefreshSections: refreshSections,
        onCancel: () => closeForm(false),
        onSaved: () => closeForm(true),
      }),
    backups.length === 0 && !loading ? jsx('p', { style: styles.hint, children: t('backup.empty') }) : null,
    backups.length === 0 ? null : jsx('table', { style: styles.table, children: [
      jsx('thead', { children: jsx('tr', { children: [
        jsx('th', { style: { ...styles.th, width: '100%' }, children: t('backup.name') }),
        jsx('th', { style: { ...styles.th, whiteSpace: 'nowrap' }, children: '' }),
        jsx('th', { style: { ...styles.th, whiteSpace: 'nowrap' }, children: '' }),
      ] }) }),
      // The running/refreshing pills reuse styles.spinner, so this page needs the
      // same keyframes block StoragePage mounts.
      jsx('style', { children: SPIN_KEYFRAMES }),
      jsx('tbody', { children: backups.map(backup => jsx(BackupRow, {
        backup,
        providers,
        t,
        busy,
        running: runningId === backup.id,
        formOpen: form !== null,
        onRun: run,
        onEdit: id => { setEditingId(id); setAdding(false) },
        onRemove: remove,
      }, backup.id)) }),
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

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: BACKUP_SECTION_ID,
    order: 37,
    locale: NS,
    label: () => t('backup.nav.title'),
  }, BackupPage))
}

export const inject = ['slots', 'locale']
