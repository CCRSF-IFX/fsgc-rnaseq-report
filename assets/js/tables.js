export function renderTable(containerId, rows, options = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!rows || rows.length === 0) {
    el.innerHTML = '<p class="note">No table data available.</p>';
    return;
  }
  const limit = options.limit || 200;
  const columns = options.columns || Object.keys(rows[0]);
  const shown = rows.slice(0, limit);
  const header = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = shown.map((row) => `<tr>${columns.map((c) => `<td>${formatCell(row[c])}</td>`).join('')}</tr>`).join('');
  const more = rows.length > limit ? `<p class="note">Showing first ${limit} of ${rows.length} rows.</p>` : '';
  const button = options.exportName ? `<button class="secondary" data-export-table="${containerId}">Export CSV</button>` : '';
  el.innerHTML = `${button}<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div>${more}`;
  const exportButton = el.querySelector('[data-export-table]');
  if (exportButton) {
    exportButton.addEventListener('click', () => downloadCsv(options.exportName, rows, columns));
  }
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
