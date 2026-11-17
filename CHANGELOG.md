# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

