# CI Workflows

The repository uses GitHub Actions for hosted deployment, documentation
validation, and optional browser smoke tests.

## Pages Deployment

`.github/workflows/deploy-pages.yml` publishes the hosted report through GitHub
Pages. It also:

- builds versioned MkDocs documentation under `_site/docs/<version>/`
- updates `_site/docs/latest/`
- writes `_site/docs/versions.json`
- restores preserved webR package snapshots
- builds a new webR package snapshot when needed
- uploads webR package and library bundle release assets

Repository Pages must use **GitHub Actions** as the source.

## MkDocs CI

`.github/workflows/ci_mkdocs.yaml` validates documentation on pull requests,
pushes, and manual runs. It builds the same versioned documentation layout used
by Pages deployment, but only uploads it as a CI artifact.

## Manual Inputs

The Pages workflow supports:

- `force_overwrite`: rebuild and replace an existing webR package snapshot when
  set to `true`
- `docs_version`: override only the documentation path for a manual run

Use `force_overwrite=true` sparingly. Package snapshots are intended to be
immutable.

## Local Validation

Useful checks before pushing workflow or documentation changes:

```bash
mkdocs build --strict
```

```bash
git diff --check
```

If available, also run:

```bash
actionlint .github/workflows/*.yml .github/workflows/*.yaml
```
