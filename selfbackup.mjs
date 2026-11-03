/**
 * dsh-storage backs itself up.
 *
 * This is NOT a separate package: it is a participant of the backup engine in
 * `backup.mjs`. On the synchronous `dsh-storage/prepare-backup` event it creates
 * a `dsh-storage.cfg` section carrying the plugin's own config (secret-free) and
 * a RESTORE.md; on the asynchronous `dsh-storage/backup-section` event for that
 * section it dumps the credential references the plugin itself owns and marks
 * the section `status: ok`.
 *
 * Only references derived from the configured storage providers and backup
 * entries are resolved — the reference space has no enumeration, so there is no
 * safe "dump everything" call, and the record space (`listRecords`) belongs to
 * every plugin, so it is deliberately left untouched.
 *
 * @module @dr-co/dsh-storage/selfbackup
 */
import { writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { atomicWriteStatus } from './backup.mjs'

/** The section this participant owns. */
export const SELF_SECTION_NAME = 'dsh-storage.cfg'

/** Credential reference of a provider's OAuth application secret. */
export function providerClientRef(id) {
  return credentialRef(`DSH_FILESTORE_${String(id).toUpperCase().replaceAll('-', '_')}_CLIENT`)
}

/**
 * The settings document as it should be restored: providers and backups without
 * secret values. Both are already normalized (secrets live in credentials), so
 * this only drops the non-persisted `known` flag and clones `options`.
 */
export function sanitizeConfigDocument(providers, backups) {
  return {
    providers: (providers ?? []).map(entry => ({ ...entry, options: { ...(entry?.options ?? {}) } })),
    backups: (backups ?? []).map(({ known, ...rest }) => rest),
  }
}

/**
 * Every credential reference this plugin owns for the currently configured
 * entries: the provider token, the provider's OAuth app secret, and each
 * backup entry's encryption key.
 */
export function collectCredentialRefs(providers, backups) {
  const refs = new Set()
  for (const entry of providers ?? []) {
    if (typeof entry?.credentialRef === 'string' && entry.credentialRef !== '') refs.add(entry.credentialRef)
    if (typeof entry?.id === 'string' && entry.id !== '') refs.add(providerClientRef(entry.id))
  }
  for (const entry of backups ?? []) {
    if (typeof entry?.credentialRef === 'string' && entry.credentialRef !== '') refs.add(entry.credentialRef)
  }
  return [...refs]
}

/** Resolve each reference; unresolved references are simply absent. */
export async function resolveCredentialRefs(store, refs) {
  const references = {}
  if (store === null || store === undefined || typeof store.resolve !== 'function') return references
  for (const ref of refs) {
    try {
      const resolved = await store.resolve(ref)
      const value = resolved === undefined || resolved === null
        ? undefined
        : (typeof resolved === 'string' ? resolved : resolved.value)
      if (typeof value === 'string' && value !== '') {
        references[ref] = {
          source: resolved !== null && typeof resolved === 'object' ? resolved.source : undefined,
          value,
        }
      }
    } catch {
      // A reference that cannot be resolved is not backed up, not fatal.
    }
  }
  return references
}

/** The credentials file body, close to the store's key -> value shape. */
export function credentialsDocument(references) {
  return {
    version: 1,
    note: 'Resolved dsh-storage credential references. Restore each with ctx.credentials.set(ref, value). The backup encryption key is kept inside the (encrypted) archive, never in the plaintext RESTORE.md.',
    references,
  }
}

/** The restore instructions, UTF-8, no secret values. */
export const RESTORE_MD = `# dsh-storage — восстановление

Секция \`dsh-storage.cfg\` — конфиг плагина dsh-storage и его credentials на
момент резервного копирования. Порядок ниже важен.

## 1. Установка

- DeepSeek Harness с плагином \`@dr-co/dsh-storage\` (>= 0.2.0). Плагин ставится
  как бандл: \`dsh plugin --profile <профиль> add @dr-co/dsh-storage\`.
- Зависимости хоста: Node.js >= 22. Внешний \`gpg\` нужен только чтобы вручную
  расшифровать архив — сам плагин шифрует через OpenPGP.js без внешнего gpg.

## 2. Распаковка

Архив — это tar. Если он зашифрован, сначала расшифруйте:

\`\`\`
gpg --batch --yes --pinentry-mode loopback --passphrase "<ключ>" \\
  -d <имя>.tar.gpg > <имя>.tar
\`\`\`

Ключ в этот файл не пишется — он у вас в парольном менеджере/secret-хранилище.
Затем распакуйте:

\`\`\`
tar -xf <имя>.tar
\`\`\`

## 3. Порядок восстановления

1. \`config.json\` — настройки плагина (providers/backups) без секретов.
   Восстановите их в namespace \`dsh-storage\` через
   \`settings.update('dsh-storage', { providers, backups })\`
   или через админ-панель «Хранилища» и «Резервные копии».
2. \`credentials.json\` — ссылки на секреты. Для каждой записи в \`references\`
   выполните \`ctx.credentials.set(ref, value)\`: вернутся токены хранилищ,
   OAuth app-secret и ключи шифрования резервных копий.
3. \`status.json\` — служебный статус секции, менять не нужно.

## 4. Проверка

- В админке «Хранилища» нажмите «Проверить» у каждого хранилища.
- В «Резервных копиях» нажмите «Запустить», чтобы убедиться, что ключ
  шифрования и хранилище читаются.
- Убедитесь, что \`storage_list\`/\`storage_read\` работают.
`

/**
 * Synchronous half of the participant: create the section and write the
 * secret-free config plus RESTORE.md. Runs inside the sync prepare event.
 */
export function prepareSelfSection(workspace, { providers = [], backups = [] } = {}) {
  const dir = workspace.section(SELF_SECTION_NAME)
  writeFileSync(path.join(dir, 'config.json'), `${JSON.stringify(sanitizeConfigDocument(providers, backups), null, 2)}\n`, 'utf8')
  writeFileSync(path.join(dir, 'RESTORE.md'), RESTORE_MD, 'utf8')
  return dir
}

/**
 * Asynchronous half: dump the owned credentials and mark the section ok. Runs
 * inside the async section event, so credential resolution may await.
 */
export async function finalizeSelfSection(directory, { store, providers = [], backups = [] } = {}) {
  const refs = collectCredentialRefs(providers, backups)
  const references = await resolveCredentialRefs(store, refs)
  await writeFile(path.join(directory, 'credentials.json'), `${JSON.stringify(credentialsDocument(references), null, 2)}\n`, 'utf8')
  atomicWriteStatus(directory, { status: 'ok', pids: [] })
}
