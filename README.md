# dsh-storage

Remote disks for DeepSeek Harness: a model gets storages it can look at, read
from and write to, and the same storages carry encrypted backups.

Бэкап — **не отдельный плагин и не отдельный пакет**: это расширение
`@dr-co/dsh-storage` в том же namespace настроек, том же админ-API и той же
клиентской панели. Движок лежит в `backup.mjs` (export `./backup`).

## Что уже есть

- сервис `ctx.filestore`: список хранилищ, основное, статусы, `test()`;
- драйвер `local` (каталог на этом хосте) — `put`, `get`, `list`, `stat`,
  `delete`, `mkdir`, `free`, `put_file` / `get_file` для больших файлов;
- драйвер `s3` — любой S3-совместимый сервис (AWS, Яндекс Object Storage,
  Selectel, VK, R2, B2, MinIO) на голом `fetch` с SigV4 из `node:crypto`,
  многочастная загрузка для больших файлов, без AWS SDK;
- драйвер `webdav` — Nextcloud, ownCloud, NAS: PROPFIND для листинга и stat,
  PUT/GET/DELETE/MKCOL, квота через RFC 4331, если сервер её отдаёт;
- инструменты модели: `storage_list`, `storage_ls`, `storage_read`,
  `storage_write`, `storage_mkdir`, `storage_df`, `storage_delete`;
- секция системного промпта `tool:filestore` (статическая — кэш промпта живёт);
- настройки в namespace `dsh-storage` и админ-API `/__fs`.

Чего нет: OAuth-провайдеров
(Google), `rclone`, `sftp`. Всё это — следующие коммиты,
по плану из спеки.

## S3

`options`: `bucket` (обязательно), `region` (по умолчанию `us-east-1`),
`endpoint` (для не-AWS; путь будет path-style, `forcePathStyle: false` переключает
на virtual-host), `partSize` (по умолчанию 8 МиБ; настоящий S3 требует не меньше
5 МиБ на часть, кроме последней).

Секрет лежит в credentials под `credentialRef` и принимается в одном из видов:

```json
{"accessKeyId": "…", "secretAccessKey": "…"}
```

либо `keyId:secret` одной строкой, либо двумя строками. Ключ доступа — это тоже
секрет, поэтому оба значения живут в creds, а не в `options`.

## Установка

```bash
dsh plugin --profile web add @dr-co/dsh-storage
```

Плагин — бандл: `cordis.patch.yml` вставляет запись `@dr-co/dsh-storage`
в профиль.

## Хранилище

```jsonc
{
  "id": "st-0001",            // выдаётся один раз, не меняется
  "type": "local",            // пока только local
  "label": "Мои файлы",
  "enabled": true,
  "role": "primary",          // primary | secondary
  "readOnly": false,
  "basePath": "dsh",          // префикс внутри корня, можно пустой
  "credentialRef": "DSH_FILESTORE_ST_0001",
  "options": { "root": "/srv/data" }
}
```

Секреты живут только в `ctx.credentials` под `credentialRef`; в документе
настроек их нет и не будет. Основное хранилище может быть только одно — если
флаг `primary` стоит у нескольких записей, его сохраняет первая.

## Каталог на носителе без каталогов

У S3 каталогов нет, есть только ключи. Поэтому `storage_mkdir` там создаёт
объект `<prefix>/.dsh-storage-keep` и возвращает
`{created: true, medium: "marker"}`. Файл-хранитель не попадает ни в листинг,
ни в архив. Модель получает успех и честное объяснение, чем он создан.

## Админ-API

`/__fs` — JSON, монтируется только если в профиле есть `webServer`.

| метод | путь | что делает |
| --- | --- | --- |
| GET | `/__fs/providers` | список хранилищ, статусы, задан ли секрет |
| POST | `/__fs/providers` | добавить (`secret` сразу уходит в credentials) |
| PATCH | `/__fs/providers/:index` | изменить |
| DELETE | `/__fs/providers/:index` | удалить (основное — только после смены основного) |
| POST | `/__fs/providers/:index/test` | проверка: запись → чтение → удаление пробника |
| POST | `/__fs/providers/:index/primary` | назначить основным |

## WebDAV

`options.baseUrl` — адрес коллекции, например
`https://cloud.example/remote.php/dav/files/user`. Секрет в credentials: JSON
`{"username": "…", "password": "…"}`, либо `user:password` одной строкой, либо
две строки. Пароль приложения лучше обычного пароля.

## Ловушка, которая роняет хост

Поле конфига, которое меняется из панели, обязано быть `.volatile()`:
`dsh-settings` отказывается писать не-volatile поля и кидает
`Plugin entry "<id>" has no volatile fields`, а это валит процесс целиком.
Читается такое поле через `get()`, а не как массив. Есть тест, который это ловит.

## Ключи

Ключ — POSIX-путь внутри `basePath`, не абсолютный путь. Запрещены `..`, `.`,
пустые сегменты, NUL и длина больше 1024. Разрешение пути никогда не выходит
за корень хранилища.

## Бэкапы

Карточка бэкапа в админке: `name`, `providerId` (id одного из настроенных
хранилищ), `directory` (каталог внутри хранилища), `rotation` (сколько пар
архивов хранить, по умолчанию 10), `timeoutSeconds` (таймаут одной секции,
по умолчанию 300), `include`/`ignore` (глобы имён секций), `sections`
(последний discovery, заполняется действием «Обновить список секций»), `key`
(ключ шифрования) и необязательный `schedule` (пятипольный cron).

`include=[]` эквивалентно `*` (все секции), `ignore=[]` ничего не исключает,
`ignore` приоритетнее `include`.

### Событийная модель

- `dsh-storage/prepare-backup` — синхронно (`ctx.emit`), получает
  `BackupWorkspace`. Участники синхронно создают любое число секций через
  `workspace.section(name)`; секция — это каталог, может нести
  `RESTORE.md` и обязана поддерживать `status.json`.
- `dsh-storage/backup-start` — синхронно (`ctx.bail`), вызывается
  последовательно для каждой выбранной секции прямо перед `backup-section`,
  получает `{ directory, section }`. Хук синхронно стартует дочерний процесс и
  возвращает PID(ы) — `{ pids: [...] }` или просто массив. Движок атомарно
  пишет `status.json` как `running` с этими pids, затем идёт обычный
  section-processing/polling. При timeout/error/no-status/child-failure хост
  `SIGKILL` все PID из `backup-start` и из `status.json`, потом удаляет
  workspace. Следующий `backup-start` — только после завершения предыдущей
  секции.
- `dsh-storage/backup-section` — асинхронно (`ctx.parallel`), получает
  `{ directory, section, signal }`. Хост не ждёт промис обработчика: он
  запускает событие и **опрашивает `status.json` не чаще 1 раза в секунду** с
  явным yield, пока не появится `status=ok/error/child-failed`. Отсутствие
  перезаписи `status.json` (inode не изменился) — ошибка по контракту.
  Rejection промиса обработчика не теряется. Таймаут действует на всю секцию.
- Секции обрабатываются последовательно; секции разных участников чередуются
  обычной сортировкой имён. Перед обработкой секции фильтруются
  `include`/`ignore`; discovered-список сохраняется целиком, независимо от
  выбранного поднабора.

`status.json`: `{ status, updatedAt, pids, message? }`. `status` — `ok`,
`running`, `error` или `child-failed`; `pids` — PID дочерних процессов,
которые хост убивает (`SIGKILL`) при любой ошибке. Результат любого запуска
содержит `code` и `message`; при ошибке — структурированные `details.sections`
с исходом (`timeout`, `no-status-update`, `error-status`, `child-failure`).

### Архив

Внешний загружаемый архив — всегда чистый
`<sanitized-name>_YYYY-MM-DD_HH.mm.ssZ.tar`, рядом `.sha256` (формат
`sha256sum`); снаружи `.gpg` нет. Внешний tar содержит **только файлы верхнего
уровня**:

- `RESTORE.md` — общий, открытый, описывает контейнер и порядок распаковки;
- `<section>.tar.zstd[.gpg]` — на каждую выбранную секцию: tar с корневым
  каталогом секции (Unix-права/режимы), сжатый zstd и зашифрованный OpenPGP.
  Section-specific `RESTORE.md` лежит внутри этого архива. После `gpg -d`
  получается `<section>.tar.zstd`, читается `zstd -dc | tar -xf -`.

`status.json` — служебный статус обработки, в контейнер не входит. Ключ:
обрезаются только начальные/конечные пробелы, внутренние сохраняются, UTF-8
байты → base64 в credentials; при использовании — обратное декодирование.
zstd — встроенный `node:zlib`, внешних zstd-зависимостей нет.

Workspace живёт внутри дерева DSH (`<DSH_HOME>/storage/backups/…`), не в `/tmp`,
и удаляется после завершения. Пустая выборка секций возвращает
`code: "ok"`, `message: "empty backup was not uploaded"` и ничего не грузит.

### Админ-API

Под `/api/filestore` (канал владельца, как у хранилищ):

| метод | путь | что делает |
| --- | --- | --- |
| GET | `/api/filestore/backups` | список бэкапов + хранилища для выбора |
| POST | `/api/filestore/backups/save` | создать/изменить (`key` кодируется в credentials) |
| POST | `/api/filestore/backups/delete` | удалить запись |
| POST | `/api/filestore/backups/run` | запустить сейчас, вернуть результат |
| POST | `/api/filestore/backups/sections` | prepare-only: записать фактический список секций |

### Self-backup: `dsh-storage.cfg`

dsh-storage участвует в собственном бэкапе: на `prepare-backup` создаёт секцию
`dsh-storage.cfg/`, на `backup-section` дописывает её. Внутри секции (до
архивации):

- `config.json` — providers/backups без секретов (настройки namespace
  `dsh-storage` для `settings.update`);
- `credentials.json` — только собственные ссылки credentials: токены
  хранилищ, OAuth app-secret и ключи бэкапов, выведенные из настроенных
  записей (reference-пространство не перечисляется, поэтому чужое не дампится;
  `listRecords` не трогается);
- `RESTORE.md` — установка, распаковка, порядок восстановления config затем
  credentials, проверка; ключ бэкапа в открытый файл не пишется;
- `status.json` — атомарно, `status: ok` (в итоговый контейнер не входит).

В контейнер секция попадает как `dsh-storage.cfg.tar.zstd.gpg` (config,
credentials и собственный RESTORE.md внутри зашифрованного архива); открытым
остаётся только общий `RESTORE.md`.

### Тест-участник: `test`

Для ручной диагностики hooks/status в GUI встроен тестовый участник
(`testhook.mjs`), пока **включён всегда** (без config-флага). На каждом backup
он добавляет секцию `test`:

- `prepare-backup` — синхронно создаёт `test/` с `marker.txt` и `RESTORE.md`;
- `backup-start` — запускает дочерний Node-процесс, который ждёт 30 секунд и
  затем атомарно пишет `test/status.json` = `{status: "ok", pids: []}`;
  возвращает `{ pids: [child.pid] }`;
- `backup-section` — не блокирует событие; движок в `delegated`-режиме
  опрашивает status.json до `ok`.

В итоговый контейнер секция попадает как `test.tar.zstd.gpg` (marker + собственный
RESTORE.md внутри; `status.json` исключён). Позже участника планируется убрать
или сделать config-флагом.

### Run-state и lastRun

На каждый backup id держится in-process lock (один процесс): одновременный
запуск того же id возвращает `code: "BACKUP_ALREADY_RUNNING"` (HTTP 409 для
API, machine-readable для `backup_run`). Пока id running, его `save`/`delete`
тоже отвечают 409. `finally` снимает lock при любом исходе.

В настройках записи хранится `lastRun: { startedAt, finishedAt?, code, message }`:
при старте пишется `startedAt` + `code: "running"`, по завершении — `finishedAt`,
code и message. `GET /backups` и `backup_list` отдают `running`/`startedAt` и
`lastRun`; GUI показывает статус/время последней попытки и периодически
обновляет список во время run.

### Ограничения (host API не позволяет)

- **Cron**: готового cron-сервиса у хоста нет, поэтому шедулер — внутренний,
  тикает раз в минуту по полю `schedule`. Ошибка cron логируется в stderr;
  успех просто возвращает результат.
- **Пробуждение модели**: публичного сервиса «разбудить модель» для фонового
  плагина нет. Есть seam `config.notifyBackupError(result)` — по умолчанию
  только лог; привязка к inbox агента остаётся на стороне хоста.
- **Секции и статусы**: статус-строки секций и семантика дочерних процессов —
  контракт участника; хост считает ошибкой всё, кроме `ok`.
- **Dropbox и Google** не добавлялись и не возвращаются.

## Тесты

```bash
npm test
```
