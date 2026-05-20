// @ts-check
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';
import { openReport } from './helpers/reportPage.js';

const STANDALONE_PATH = 'dist/playwright-standalone-smoke.html';

test.beforeAll(() => {
  execFileSync(
    'python3',
    [
      'scripts/build_report_bundle.py',
      '--data-root',
      'assets/data/simulated',
      '--output',
      STANDALONE_PATH,
    ],
    { cwd: process.cwd(), stdio: 'inherit' },
  );
});

test('generated standalone report loads without module script tags', async ({ page }) => {
  await openReport(page, `/${STANDALONE_PATH}`);

  await expect(page).toHaveTitle(/RNA-seq Report/);
  await expect(page.locator('#report-title')).not.toBeEmpty();
  await expect(page.locator('#status-text')).toContainText(/Report assets loaded/i);

  await expect(page.locator('#contrast-count')).toHaveText('0');
  await expect(page.locator('#de-table-status')).toContainText('No DE results are loaded yet');
  await expect(page.locator('script[type="module"]')).toHaveCount(0);
  await expect.poll(
    () => page.evaluate(() => Object.keys(globalThis.REPORT_EMBEDDED_ASSETS || {}).length),
  ).toBeGreaterThan(0);
});
