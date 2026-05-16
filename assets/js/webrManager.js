import { state, logAnalysis } from './state.js';

let webR = null;
let initialized = false;
const DEFAULT_WEBR_PACKAGE_REPO = 'https://repo.r-wasm.org/';

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

export async function runSmallSummary() {
  await initWebR();
  const out = await evalR('capture.output(sessionInfo())');
  logAnalysis(Array.isArray(out?.values) ? out.values.join('\n') : 'sessionInfo() complete.');
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
