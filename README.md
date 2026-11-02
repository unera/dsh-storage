# dsh-storage

Remote disks for DeepSeek Harness: a model gets storages it can look at, read
from and write to, and later the same storages carry full backups.

Пока это **этап 1** — чистый диск. Бэкапов здесь ещё нет.

## Что уже есть

- сервис `ctx.filestore`: список хранилищ, основное, статусы, `test()`;
- драйвер `local` (каталог на этом хосте) — `put`, `get`, `list`, `stat`,
  `delete`, `mkdir`, `free`, `put_file` / `get_file` для больших файлов;
- инструменты модели: `storage_list`, `storage_ls`, `storage_read`,
  `storage_write`, `storage_mkdir`, `storage_df`, `storage_delete`;
- секция системного промпта `tool:filestore` (статическая — кэш промпта живёт);
- настройки в namespace `dsh-storage` и админ-API `/__fs`.

Чего нет: драйверов `s3` и `webdav`, клиентской панели в настройках, OAuth.
Всё это — следующие коммиты, по плану в `docs/dsh-storage-spec.md` рабочего
репозитория.

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

## Ключи

Ключ — POSIX-путь внутри `basePath`, не абсолютный путь. Запрещены `..`, `.`,
пустые сегменты, NUL и длина больше 1024. Разрешение пути никогда не выходит
за корень хранилища.

## Тесты

```bash
npm test
```
