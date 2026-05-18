const DATATABLES_VERSION = '2.3.8';
const JQUERY_JS = 'https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js';
const DATATABLES_CSS = `https://cdn.datatables.net/${DATATABLES_VERSION}/css/dataTables.dataTables.min.css`;
const DATATABLES_JS = `https://cdn.datatables.net/${DATATABLES_VERSION}/js/dataTables.min.js`;

let dataTablesAssetPromise = null;

export function renderTable(containerId, rows, options = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!rows || rows.length === 0) {
    el.innerHTML = '<p class="note">No table data available.</p>';
    return;
  }
  const allRows = Array.isArray(rows) ? rows : [];
  const displayLimit = tableDisplayLimit(options.limit, allRows.length);
  const displayRows = displayLimit ? allRows.slice(0, displayLimit) : allRows;
  const isTruncated = displayRows.length < allRows.length;
  const columns = options.columns || Object.keys(rows[0]);
  const useFullDataTable = isTruncated && !options.previewOnly && options.dataTables !== false;
  const initialRows = useFullDataTable ? [] : displayRows;
  const header = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = initialRows.length
    ? tableBodyHtml(initialRows, columns)
    : (useFullDataTable ? `<tr><td colspan="${columns.length}">Loading interactive table...</td></tr>` : '');
  const button = options.exportName ? `<button class="secondary" data-export-table="${containerId}">Export CSV</button>` : '';
  const previewNote = useFullDataTable
    ? `<p class="note table-preview-note">Loading interactive table with all ${allRows.length.toLocaleString()} rows. If DataTables cannot load, a preview of ${displayRows.length.toLocaleString()} rows will be shown.</p>`
    : (isTruncated
    ? `<p class="note table-preview-note">Showing first ${displayRows.length.toLocaleString()} of ${allRows.length.toLocaleString()} rows. Export CSV includes all rows.</p>`
      : '');
  el.innerHTML = `${button}${previewNote}<div class="table-wrap data-table-wrap"><table class="report-table"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>`;
  const exportButton = el.querySelector('[data-export-table]');
  if (exportButton) {
    exportButton.addEventListener('click', () => downloadCsv(options.exportName, allRows, columns));
  }
  enhanceTablesWithin(el, {
    ...options,
    dataRows: useFullDataTable ? allRows : null,
    dataColumns: useFullDataTable ? columns : null,
    fallbackRows: useFullDataTable ? displayRows : null,
    fallbackTotalRows: useFullDataTable ? allRows.length : null,
  });
}

export function enhanceTablesWithin(root, options = {}) {
  const container = typeof root === 'string' ? document.getElementById(root) : root;
  if (!container) return;
  const tables = Array.from(container.querySelectorAll('table')).filter((table) => !table.dataset.datatableReady);
  if (!tables.length) return;

  loadDataTablesAssets()
    .then(() => {
      if (!globalThis.DataTable) return;
      tables.forEach((table) => {
        if (!table.isConnected || table.dataset.datatableReady) return;
        table.dataset.datatableReady = 'true';
        table.classList.add('display', 'report-data-table');
        const dataRows = Array.isArray(options.dataRows) ? options.dataRows : null;
        const dataColumns = Array.isArray(options.dataColumns) ? options.dataColumns : [];
        if (dataRows) table.querySelector('tbody').innerHTML = '';
        new globalThis.DataTable(table, {
          ...(dataRows ? {
            data: dataRows.map((row) => dataColumns.map((column) => row[column])),
            columns: dataColumns.map((column) => ({
              title: escapeHtml(column),
              render: (data, type) => (type === 'display' ? formatCell(data) : (data ?? '')),
            })),
          } : {}),
          pageLength: options.pageLength || 25,
          lengthMenu: [[10, 25, 50, 100, -1], [10, 25, 50, 100, 'All']],
          order: [],
          autoWidth: false,
          scrollX: true,
          deferRender: true,
        });
        renderFullDataTableNote(container, dataRows?.length);
      });
    })
    .catch(() => {
      renderTableFallback(container, options);
      // Keep the plain HTML table usable if the CDN is unavailable.
    });
}

export function adjustVisibleDataTables() {
  try {
    globalThis.DataTable?.tables?.({ visible: true, api: true })?.columns?.adjust?.();
  } catch (_) {
    // Hidden-tab sizing is best-effort; tables remain usable without an adjustment.
  }
}

function loadDataTablesAssets() {
  if (!dataTablesAssetPromise) {
    dataTablesAssetPromise = loadStylesheet(DATATABLES_CSS)
      .then(() => (globalThis.jQuery ? null : loadScript(JQUERY_JS)))
      .then(() => (globalThis.DataTable ? null : loadScript(DATATABLES_JS)));
  }
  return dataTablesAssetPromise;
}

function tableDisplayLimit(limit, rowCount) {
  const value = Number(limit);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), rowCount);
}

function tableBodyHtml(rows, columns) {
  return rows.map((row) => `<tr>${columns.map((c) => `<td>${formatCell(row[c])}</td>`).join('')}</tr>`).join('');
}

function renderFullDataTableNote(container, rowCount) {
  if (!rowCount) return;
  const note = container.querySelector('.table-preview-note');
  if (note) note.textContent = `Interactive table includes all ${rowCount.toLocaleString()} rows. Export CSV includes all rows.`;
}

function renderTableFallback(container, options = {}) {
  const rows = Array.isArray(options.fallbackRows) ? options.fallbackRows : null;
  const columns = Array.isArray(options.dataColumns) ? options.dataColumns : null;
  if (!rows || !columns) return;
  const table = container.querySelector('table');
  const tbody = table?.querySelector('tbody');
  if (!tbody) return;
  tbody.innerHTML = tableBodyHtml(rows, columns);
  const note = container.querySelector('.table-preview-note');
  if (note) {
    const total = Number(options.fallbackTotalRows);
    note.textContent = Number.isFinite(total)
      ? `DataTables could not load. Showing first ${rows.length.toLocaleString()} of ${total.toLocaleString()} rows. Export CSV includes all rows.`
      : 'DataTables could not load. Showing a preview table.';
  }
}

function loadStylesheet(href) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`link[href="${href}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${href}`)), { once: true });
      if (existing.dataset.loaded === 'true' || existing.sheet) resolve();
      return;
    }

    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.onload = () => { link.dataset.loaded = 'true'; resolve(); };
    link.onerror = () => reject(new Error(`Failed to load ${href}`));
    document.head.appendChild(link);
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      if (existing.dataset.loaded === 'true') resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.onload = () => { script.dataset.loaded = 'true'; resolve(); };
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

export function downloadCsv(filename, rows, columns = null) {
  const cols = columns || Object.keys(rows[0] || {});
  const csv = [cols.join(',')].concat(rows.map((row) => cols.map((c) => csvEscape(row[c])).join(','))).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function formatCell(value) {
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return String(value);
    return value.toPrecision(4);
  }
  return escapeHtml(value ?? '');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}
