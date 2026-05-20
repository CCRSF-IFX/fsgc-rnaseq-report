# Open The Report

Most delivered reports can be opened by double-clicking the HTML file. Core
tables and plots are embedded in the report and should work without installing
software.

## Local HTML File

Open the delivered `.html` file in a modern browser such as Chrome, Edge,
Firefox, or Safari. The report should load its embedded data, styles, and
JavaScript directly from the file.

Optional webR analysis can be more sensitive to browser security rules on
`file://` pages. If DESeq2 or GSEA package loading fails from a local file, open
the same report from a simple static web server or ask the report provider for a
hosted URL.

## Hosted Report

If your team provides a hosted URL, open that URL directly. Hosted reports are
usually better for optional webR workflows because package downloads and browser
workers run from an `http://` or `https://` origin.

## First Checks

After the report opens:

- Check the project title and run information in the sidebar.
- Open the Guide tab and review **Report versions and links** for the hosted
  report, documentation, source repository, and package snapshot URLs.
- Open the sample metadata view and confirm sample names look familiar.
- Review QC and PCA before running downstream analysis.
- If the report asks for a webR package bundle, follow the on-screen buttons to
  download and choose the bundle.

## What Works Offline

Embedded report data, static tables, and most plots can work offline in a
standalone build. Browser-run DESeq2 and GSEA need either online package access
or a local webR library bundle selected through the report.
