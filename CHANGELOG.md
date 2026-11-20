# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.28] - 2026-11-20

### Added

- The S3 form has an upload part size: a large file goes up in parts of that size and the storage
  assembles it. 16 MiB by default, 5 MiB minimum (an S3 rule), 5120 MiB at most; the value is kept
  per storage in `options.partSize`.
- Saving an S3 storage refuses a secret it cannot parse and a part size out of range, so both are
  reported in the form instead of surfacing on the first upload, minutes into a backup.

### Fixed

- `key : secret` written with spaces around the colon no longer yields a key with a trailing space
  and a secret with a leading one.
- The secret field keeps naming the three accepted shapes while an existing storage is edited, not
  only while a new one is added.

### Changed

- The credentials hint lists all three shapes — JSON, two lines, `key:secret` — instead of JSON alone.

## [0.2.27] - 2026-11-20

### Fixed

- A backup no longer dies on a symlink that does not resolve: entries are described with `lstat`, so
  a section copied from a live system (`/etc/alternatives/*`, a dovecot key pointing outside the
  tree) does not throw `ENOENT` out of the async generator and take the process down.

## [0.2.26] - 2026-11-17

### Fixed

- A long non-ASCII file name survives the backup: the entry is written and read back unchanged,
  which `tar` alone did not guarantee for names past a certain length.

## [0.2.25] - 2026-11-15

### Fixed

- The backup form no longer offers a storage that has been deleted: the list is read from the
  current state, not from the one the form was opened with.

## [0.2.24] - 2026-11-15

### Changed

- **Primary is optional.** The last storage may be deleted, and a property without a primary is a
  valid state — a node can have storages and none of them marked primary. The write path names
  the storage it writes to instead of falling back to a primary that may not exist.
- `FILESTORE_PRIMARY_IN_USE` is gone: deleting the primary storage no longer returns `409`. A
  client that keyed on that code must stop treating it as an error.
- The message of `FILESTORE_NO_PRIMARY` now says that no storage is chosen for writing, because
  that is what it means — it used to claim the primary was in use.

