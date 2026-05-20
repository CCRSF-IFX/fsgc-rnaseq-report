# GitHub Pages And webR Snapshots

The repository includes a GitHub Actions workflow that publishes the hosted
report and builds the webR package snapshot used by optional browser analysis.

## Hosted Report Deployment

`.github/workflows/deploy-pages.yml` runs on pushes to `main` or `master`, or
manually through `workflow_dispatch`.

The workflow:

1. Reads the configured webR package snapshot version.
2. Prepares a static `_site/` directory for GitHub Pages.
3. Restores preserved historical webR package snapshots.
4. Builds the current webR package repository with `r-wasm/actions`.
5. Uploads release assets for package and library snapshots.
6. Publishes `_site/` through GitHub Pages.

Repository Pages should be configured to use GitHub Actions as the source.

## webR Package Snapshot

The package snapshot is defined by:

- `webr-packages/VERSION`
- `webr-packages/packages`
- `webr-packages/published_versions`
- `webr-packages/patches/`

The current report configuration points webR package installation at:

```text
https://omicsreporthub.github.io/rnaseq-report/webr-packages/v0.1.0/
```

The package repository must match the webR runtime configured in
`assets/report_config.json`.

## Versioning Rules

Treat package snapshots as immutable. When package contents change:

1. Choose a new `webr-packages/VERSION`.
2. Update `assets/report_config.json`.
3. Preserve old versions in `webr-packages/published_versions` when older
   reports still point to them.
4. Let the Pages workflow publish the new snapshot and release assets.

The deployment workflow refuses to overwrite an existing package snapshot by
default. Manual runs can opt into `force_overwrite=true` when an intentional
replacement is needed.

## Documentation Workflow

`.github/workflows/ci_mkdocs.yaml` validates this documentation with MkDocs. It
builds the docs as a CI artifact and does not deploy to `gh-pages`, so it avoids
conflicting with the report demo Pages workflow.
