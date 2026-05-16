# webR Package Snapshot

This directory defines the report-scoped WebAssembly R package repository built
with the GitHub Pages workflow.

- `VERSION` is the immutable snapshot path published under
  `webr-packages/<VERSION>/`.
- `packages` contains package references for `rwasm::add_pkg()`.
- `patches/` contains project-local Makevars overrides installed into the
  rwasm build environment before package compilation.
- `published_versions` lists old snapshots that should be preserved during
  future deploys.

When package contents change, create a new version instead of overwriting an
existing report snapshot. The Pages workflow blocks overwrites by default, but
manual workflow runs can set `force_overwrite=true` when a same-version
replacement is intentional.

Each deployment also writes a downloadable archive next to the package repo:

```text
webr-packages/<VERSION>/webr-packages-<VERSION>.zip
```

The archive contains the compiled `bin/emscripten/contrib/4.5` package index and
artifacts for users who want to mirror or inspect the wasm package snapshot.
