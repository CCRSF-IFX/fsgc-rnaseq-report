import { state, logAnalysis } from './state.js';

let webR = null;
let initialized = false;
const DEFAULT_WEBR_PACKAGE_REPO = 'https://repo.r-wasm.org/';
const JSZIP_CDN = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
const PAKO_CDN = 'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js';

export async function initWebR() {
  if (initialized) return webR;
  const cfg = state.config?.webr || {};
  if (!cfg.enabled) throw new Error('webR is disabled in report_config.json.');
  const baseUrl = normalizeWebRBaseUrl(cfg.baseUrl || 'https://webr.r-wasm.org/latest/');
  try {
    logAnalysis(`Loading webR from ${baseUrl}`);
    if (isNullOriginFilePage()) {
      logAnalysis('Local file page detected; applying webR worker URL compatibility shim.');
    }
    const module = await import(`${baseUrl.replace(/\/$/, '')}/webr.mjs`);
    webR = withFileOriginUrlFallback(() => new module.WebR({ baseUrl }));
    await withFileOriginUrlFallback(() => webR.init());
    initialized = true;
    const repos = packageRepoEntries();
    await evalR(`options(webr_pkg_repos = ${rNamedVector(repos)}, repos = ${rNamedVector(repos)})`);
    logAnalysis(`webR package repositories: ${repos.map((repo) => repo.url).join(', ')}`);
    logAnalysis('webR initialized.');
    return webR;
  } catch (error) {
    webR = null;
    initialized = false;
    throw new Error(webRStartupMessage(error));
  }
}

export async function evalR(code) {
  if (!webR) throw new Error('webR is not initialized.');
  const result = await webR.evalR(code);
  try { return await result.toJs(); } catch (_) { return result; }
}

export async function installRPackages(packages) {
  await initWebR();
  if (!packages || packages.length === 0) return;
  const packageVector = rCharacterVector(packages);
  const reposVector = rNamedVector(packageRepoEntries());
  logAnalysis(`Installing R packages: ${packages.join(', ')}`);
  await evalR(`webr::install(${packageVector}, repos = ${reposVector})`);
  await evalR(`
    requested <- ${packageVector}
    missing <- requested[!vapply(requested, function(pkg) length(find.package(pkg, quiet = TRUE)) > 0, logical(1))]
    if (length(missing)) {
      stop("webR install finished but package(s) were not available: ", paste(missing, collapse = ", "))
    }
  `);
  logAnalysis(`Installed R packages: ${packages.join(', ')}`);
}

export async function loadRPackage(packageName) {
  await initWebR();
  logAnalysis(`Loading R package: ${packageName}`);
  await evalR(`library(${JSON.stringify(packageName)}, character.only = TRUE)`);
}

export async function mountRLibraryBundle(files, packages = []) {
  await initWebR();
  const bundle = await readLibraryBundleFiles(files);
  const mountable = await prepareMountableLibraryBundle(bundle);
  const mountpoint = `/rnaseq-report-library-${Date.now()}`;
  await ensureDirectory(mountpoint);
  await webR.FS.mount('WORKERFS', {
    packages: [{
      blob: mountable.blob,
      metadata: mountable.metadata,
    }],
  }, mountpoint);
  await evalR(`.libPaths(unique(c(${rString(mountpoint)}, .libPaths())))`);

  const packageVector = rCharacterVector(packages);
  const missing = await evalR(`
    requested <- ${packageVector}
    if (!length(requested)) {
      character()
    } else {
      requested[!vapply(requested, function(pkg) length(find.package(pkg, quiet = TRUE)) > 0, logical(1))]
    }
  `);
  const missingValues = Array.isArray(missing?.values) ? missing.values : [];
  if (missingValues.length) {
    const visible = await mountedLibraryPackageNames(mountpoint);
    const visibleValues = Array.isArray(visible?.values) ? visible.values : [];
    const visiblePreview = visibleValues.length ? visibleValues.slice(0, 12).join(', ') : 'none';
    throw new Error(`Mounted library bundle is missing package(s): ${missingValues.join(', ')}. Package directories visible at ${mountpoint}: ${visiblePreview}.`);
  }
  logAnalysis(`Mounted webR library bundle from ${bundle.label}.`);
}

export async function runSmallSummary() {
  await initWebR();
  const out = await evalR('capture.output(sessionInfo())');
  logAnalysis(Array.isArray(out?.values) ? out.values.join('\n') : 'sessionInfo() complete.');
}

async function readLibraryBundleFiles(files) {
  const selected = Array.from(files || []).filter(Boolean);
  if (!selected.length) throw new Error('Choose a webR library bundle file.');
  const zipFile = selected.find((file) => /\.zip$/i.test(file.name || ''));
  if (zipFile) return readZipLibraryBundle(zipFile);

  const metadataFile = selected.find((file) => /\.(js\.metadata|metadata|json)$/i.test(file.name || ''));
  const dataFile = selected.find((file) => /\.(data|data\.gz)$/i.test(file.name || ''));
  if (!metadataFile || !dataFile) {
    throw new Error('Choose either a bundle ZIP, or both .data/.data.gz and .js.metadata files.');
  }
  return {
    blob: dataFile,
    compressed: /\.data\.gz$/i.test(dataFile.name || ''),
    metadata: JSON.parse(await metadataFile.text()),
    label: `${dataFile.name} + ${metadataFile.name}`,
  };
}

async function prepareMountableLibraryBundle(bundle) {
  const metadata = { ...bundle.metadata };
  if (!metadata.gzip) return bundle;
  if (!bundle.compressed) {
    throw new Error('Library bundle metadata expects gzip-compressed .data.gz content.');
  }

  logAnalysis(`Decompressing gzip-compressed webR library bundle ${bundle.label} into memory before mounting.`);
  delete metadata.gzip;
  return {
    ...bundle,
    blob: await ungzipBlob(bundle.blob),
    metadata,
  };
}

async function ungzipBlob(blob) {
  if (typeof DecompressionStream === 'function') {
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  await loadScript(PAKO_CDN);
  if (!globalThis.pako?.ungzip) {
    throw new Error('This browser cannot decompress the gzip-compressed library bundle.');
  }
  return globalThis.pako.ungzip(new Uint8Array(await blob.arrayBuffer()));
}

async function readZipLibraryBundle(file) {
  await loadScript(JSZIP_CDN);
  if (!globalThis.JSZip) throw new Error('JSZip did not load.');
  const zip = await globalThis.JSZip.loadAsync(file);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const metadataEntry = entries.find((entry) => /\.(js\.metadata|metadata|json)$/i.test(entry.name));
  const dataEntry = entries.find((entry) => /\.(data|data\.gz)$/i.test(entry.name));
  if (!metadataEntry || !dataEntry) {
    throw new Error('Bundle ZIP must contain one .data/.data.gz file and one .js.metadata file.');
  }
  const metadata = JSON.parse(await metadataEntry.async('text'));
  const blob = await dataEntry.async('blob');
  return {
    blob: namedBlob(blob, dataEntry.name),
    compressed: /\.data\.gz$/i.test(dataEntry.name || ''),
    metadata,
    label: file.name,
  };
}

async function mountedLibraryPackageNames(mountpoint) {
  return evalR(`
    path <- ${rString(mountpoint)}
    if (!dir.exists(path)) {
      character()
    } else {
      entries <- list.files(path, all.files = FALSE, no.. = TRUE)
      entries[file.exists(file.path(path, entries, "DESCRIPTION"))]
    }
  `);
}

function namedBlob(blob, name) {
  if (typeof File === 'function') {
    return new File([blob], name, { type: blob.type || 'application/octet-stream' });
  }
  try {
    Object.defineProperty(blob, 'name', { value: name, configurable: true });
  } catch (_) {
    // Older browsers may expose read-only Blob objects; the metadata still carries the file map.
  }
  return blob;
}

async function ensureDirectory(path) {
  try {
    await webR.FS.mkdir(path);
  } catch (error) {
    if (!/file exists|exists/i.test(error?.message || String(error))) throw error;
  }
}

function loadScript(src) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve();
    };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function packageRepoEntries() {
  const cfg = state.config?.webr || {};
  const repos = [];
  const configured = String(cfg.packageRepo || '').trim();
  if (configured) repos.push({ name: 'rnaseq', url: configured.replace(/\/?$/, '/') });
  repos.push({ name: 'webr', url: DEFAULT_WEBR_PACKAGE_REPO });
  return repos;
}

function rNamedVector(entries) {
  if (!entries.length) return 'character()';
  return `c(${entries.map((entry) => `${entry.name} = ${rString(entry.url)}`).join(', ')})`;
}

function rCharacterVector(values) {
  const uniqueValues = Array.from(new Set(values.map((value) => String(value).trim()).filter(Boolean)));
  if (!uniqueValues.length) return 'character()';
  return `c(${uniqueValues.map(rString).join(', ')})`;
}

function rString(value) {
  return JSON.stringify(String(value));
}

function normalizeWebRBaseUrl(value) {
  const raw = String(value || '').trim();
  try {
    const url = new URL(raw, globalThis.location?.href);
    return url.href.replace(/\/?$/, '/');
  } catch (_) {
    return raw.replace(/\/?$/, '/');
  }
}

function isNullOriginFilePage() {
  return globalThis.location?.protocol === 'file:' || globalThis.location?.origin === 'null';
}

function withFileOriginUrlFallback(callback) {
  if (!isNullOriginFilePage() || typeof globalThis.URL !== 'function') return callback();

  const OriginalURL = globalThis.URL;
  function WebRFileURL(value, base) {
    if ((base === 'null' || base === null) && typeof value === 'string') {
      if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return new OriginalURL(value);
      if (globalThis.location?.href) return new OriginalURL(value, globalThis.location.href);
    }
    return arguments.length >= 2 ? new OriginalURL(value, base) : new OriginalURL(value);
  }

  WebRFileURL.prototype = OriginalURL.prototype;
  Object.setPrototypeOf(WebRFileURL, OriginalURL);
  copyUrlStatics(OriginalURL, WebRFileURL);

  globalThis.URL = WebRFileURL;
  try {
    const result = callback();
    if (result && typeof result.finally === 'function') {
      return result.finally(() => { globalThis.URL = OriginalURL; });
    }
    globalThis.URL = OriginalURL;
    return result;
  } catch (error) {
    globalThis.URL = OriginalURL;
    throw error;
  }
}

function copyUrlStatics(source, target) {
  Object.getOwnPropertyNames(source).forEach((property) => {
    if (property in target) return;
    try {
      Object.defineProperty(target, property, Object.getOwnPropertyDescriptor(source, property));
    } catch (_) {
      // Some browser URL implementations expose non-configurable internals.
    }
  });
}

function webRStartupMessage(error) {
  const message = error?.message || String(error);
  if (isNullOriginFilePage()) {
    return [
      'webR could not start from this local file page.',
      'Open the report from an HTTP(S) URL, such as GitHub Pages or a local static server, before running DESeq2 or fgsea.',
      `Original error: ${message}`,
    ].join(' ');
  }
  return message;
}
