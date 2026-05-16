#!/usr/bin/env python3
"""Prepare a patched fastmatch source tree for webR package builds."""

from __future__ import annotations

import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path


PACKAGE = "fastmatch"
VERSION = "1.1-8"
ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "patched-src" / PACKAGE
URLS = [
    f"https://cran.r-project.org/src/contrib/{PACKAGE}_{VERSION}.tar.gz",
    f"https://cran.r-project.org/src/contrib/Archive/{PACKAGE}/{PACKAGE}_{VERSION}.tar.gz",
]


def download_tarball(target: Path) -> None:
    last_error: Exception | None = None
    for url in URLS:
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                target.write_bytes(response.read())
            return
        except Exception as error:  # pragma: no cover - surfaced in CI logs
            last_error = error
    raise RuntimeError(f"Could not download {PACKAGE} {VERSION}: {last_error}")


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        tarball = tmpdir / f"{PACKAGE}_{VERSION}.tar.gz"
        download_tarball(tarball)

        source_parent = tmpdir / "src"
        source_parent.mkdir()
        with tarfile.open(tarball, "r:gz") as archive:
            archive.extractall(source_parent)

        source = source_parent / PACKAGE
        if DEST.exists():
            shutil.rmtree(DEST)
        DEST.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(source, DEST)

    dummy = DEST / "src" / "dummy.c"
    dummy.write_text(
        """/* In native R this file only placates CRAN checks. In webR, dummy
   no-prototype calls to R_registerRoutines/R_useDynamicSymbols create wasm
   imports with signatures that do not match the runtime ABI. */

void dummy(void) {}
""",
        encoding="utf-8",
    )

    md5 = DEST / "MD5"
    if md5.exists():
        md5.unlink()

    print(f"Prepared patched {PACKAGE} {VERSION} source at {DEST}")


if __name__ == "__main__":
    main()
