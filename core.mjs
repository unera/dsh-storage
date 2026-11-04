/**
 * Core participant: capture enough DSH configuration to rebuild a comparable
 * node elsewhere. This is a built-in participant (not an external script) and
 * runs on top of the same `dsh-storage/prepare-backup` / `backup-section` hooks.
 *
 * On the synchronous prepare event it creates a `core/` section with a
 * secret-free `manifest.json` (profiles → installed plugin packages with id and
 * version, plus the bundle list) and copies the profile metadata/config files
 * (`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `cordis.yml`,
 * `cordis.patch.yml`). On the asynchronous section event it resolves credentials
 * through the `ctx.credentials` API and writes them into `credentials.json`
 * inside the (encrypted) section payload — never into the open RESTORE.md.
 *
 * The credentials API has record enumeration (`listRecords` + `readRecord`) but
 * no reference enumeration. References are therefore discovered from the
 * reference keys of the provider-managed store file
 * (`$DSH_HOME/.credentials.yaml`) and then resolved through the API. Storage
 * specific references (providers/backups) are already captured by the
 * `dsh-storage.cfg` section. See RESTORE.md for the restore order.
 *
 * @module @dr-co/dsh-storage/core
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { atomicWriteStatus, dshHome } from './backup.mjs'
import { resolveCredentialRefs } from './selfbackup.mjs'

/** The section this participant owns. */
export const CORE_SECTION_NAME = 'core'

/** Per-profile files copied verbatim for a restore. */
export const PROFILE_FILES = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'cordis.yml', 'cordis.patch.yml']

/** Read one profile's `package.json` into a secret-free manifest entry. */
export function readProfileManifest(dshHomeDir) {
  const profilesDir = path.join(dshHomeDir, 'profiles')
  let names
  try {
    names = readdirSync(profilesDir)
  } catch {
    return []
  }
  const profiles = []
  for (const name of names.sort()) {
    const pkgPath = path.join(profilesDir, name, 'package.json')
    if (!existsSync(pkgPath)) continue
    let pkg
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    } catch {
      continue
    }
    profiles.push({
      name,
      packageName: typeof pkg?.name === 'string' ? pkg.name : null,
      bundles: Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [],
      dependencies: { ...(pkg?.dependencies ?? {}) },
    })
  }
  return profiles
}

/** The secret-free manifest: profiles and their installed plugin packages. */
export function buildCoreManifest(dshHomeDir) {
  return {
    format: 1,
    kind: 'dsh-core',
    generatedAt: new Date().toISOString(),
    profiles: readProfileManifest(dshHomeDir),
  }
}

/**
 * Reference names recorded in the provider-managed store file. The reference
 * half of the credentials API has no enumeration, so these names are read from
 * the store file's `refs:` map (keys only — values are never read here).
 */
export function storeRefNames(dshHomeDir) {
  const file = path.join(dshHomeDir, '.credentials.yaml')
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const lines = text.split('\n')
  const start = lines.findIndex(line => /^refs:\s*$/.test(line))
  if (start === -1) return []
  const names = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^\S/.test(line)) break
    const match = line.match(/^ {2}([A-Za-z_][A-Za-z0-9_]*):/)
    if (match !== null && isCredentialRefName(match[1])) names.push(match[1])
  }
  return names
}

/** Copy the per-profile metadata/config files into the core section. */
export function copyProfileFiles(dshHomeDir, coreDir) {
  const profilesDir = path.join(dshHomeDir, 'profiles')
  const copied = []
  for (const profile of readProfileManifest(dshHomeDir)) {
    const sourceDir = path.join(profilesDir, profile.name)
    const targetDir = path.join(coreDir, 'profiles', profile.name)
    mkdirSync(targetDir, { recursive: true })
    for (const file of PROFILE_FILES) {
      const source = path.join(sourceDir, file)
      if (!existsSync(source)) continue
      copyFileSync(source, path.join(targetDir, file))
      copied.push(`${profile.name}/${file}`)
    }
  }
  return copied
}

/** The restore instructions for the `core` section (inside the payload). */
export const CORE_RESTORE_MD = `# dsh-storage — восстановление DSH-конфигурации (core)

Секция \`core\` — максимум конфигурации DSH на момент бэкапа. Секреты лежат в
\`credentials.json\` внутри этого же (зашифрованного) архива секции и в открытый
\`RESTORE.md\` контейнера не попадают. Ключ шифрования бэкапа нигде не пишется.

## 1. Установка DSH

- DeepSeek Harness (Node.js >= 22), как на исходном узле.
- Список бандлов/пакетов — в \`manifest.json\` (profiles → bundles, dependencies);
  точные версии — в \`profiles/<name>/pnpm-lock.yaml\`.

## 2. Плагины (точные версии)

Для каждого профиля из \`manifest.json\`:

1. Восстановите \`profiles/<name>/package.json\` и \`pnpm-lock.yaml\` в профиль.
2. Установите зависимости: \`pnpm install --frozen-lockfile\` (или эквивалент
   пакетного менеджера хоста).
3. Верните \`pnpm-workspace.yaml\`, \`cordis.yml\` и \`cordis.patch.yml\`.

## 3. Конфиги

- \`profiles/<name>/cordis.patch.yml\` — patch-слой конфигурации профиля; верните
  его на место. Прочие \`*.json\`/локи — как в п.2.

## 4. Credentials

- \`credentials.json\` внутри этого архива содержит \`records\` (authorization
  records) и \`refs\` (environment-var-style secrets).
- Для refs выполните \`ctx.credentials.set(ref, value)\`.
- Для records выполните \`ctx.credentials.modifyRecord(key, () => record)\`.
- Значения не печатайте и не выводите в логи.

## 5. Restart и проверка

- Перезапустите dsh-server.
- Проверьте, что профиль загрузился и плагины/интеграции на месте.
- Убедитесь, что \`storage_list\`/\`storage_read\` и резервные копии работают.
`

/**
 * Synchronous half: create the `core/` section with the secret-free manifest,
 * the copied profile files and RESTORE.md. Runs inside the sync prepare event.
 */
export function prepareCoreSection(workspace, { dshHomeDir = dshHome() } = {}) {
  const dir = workspace.section(CORE_SECTION_NAME)
  writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(buildCoreManifest(dshHomeDir), null, 2)}\n`, 'utf8')
  copyProfileFiles(dshHomeDir, dir)
  writeFileSync(path.join(dir, 'RESTORE.md'), CORE_RESTORE_MD, 'utf8')
  return dir
}

/**
 * Asynchronous half: resolve credentials through the credentials API and write
 * them into `credentials.json` inside the section payload, then mark ok.
 */
export async function finalizeCoreSection(directory, { dshHomeDir = dshHome(), store } = {}) {
  const records = []
  if (store !== null && store !== undefined && typeof store.listRecords === 'function') {
    try {
      for (const entry of await store.listRecords()) {
        try {
          const record = await store.readRecord(entry.key)
          if (record !== undefined) records.push({ key: entry.key, kind: entry.kind, record })
        } catch {
          // One unreadable record must not sink the whole section.
        }
      }
    } catch {
      // No enumeration available — records stay empty, refs still captured.
    }
  }
  const refs = await resolveCredentialRefs(store, storeRefNames(dshHomeDir))
  await writeFile(path.join(directory, 'credentials.json'), `${JSON.stringify({ version: 1, records, refs }, null, 2)}\n`, 'utf8')
  atomicWriteStatus(directory, { status: 'ok', pids: [] })
}

/**
 * Register the core participant's two listeners on a context.
 *
 * @returns disposers for the prepare and section listeners.
 */
export function installCoreHook(ctx, { dshHomeDir = dshHome() } = {}) {
  const disposePrepare = ctx.on('dsh-storage/prepare-backup', workspace => {
    prepareCoreSection(workspace, { dshHomeDir })
  })
  const disposeSection = ctx.on('dsh-storage/backup-section', payload => {
    if (payload?.section !== CORE_SECTION_NAME) return undefined
    return finalizeCoreSection(payload.directory, { dshHomeDir, store: ctx.credentials })
  })
  return [disposePrepare, disposeSection]
}
