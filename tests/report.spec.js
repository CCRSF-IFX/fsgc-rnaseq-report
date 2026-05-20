// @ts-check
import { test, expect } from '@playwright/test';

test('loads the report shell and configured version links', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/RNA-seq Report/);
  await expect(page.locator('#report-title')).not.toBeEmpty();
  await expect(page.locator('#status-text')).toContainText(/Report assets loaded|plots loading/i);

  await page.getByRole('button', { name: 'Guide' }).click();
  await expect(page.getByRole('heading', { name: 'Report versions and links' })).toBeVisible();

  await expect(page.getByRole('link', { name: 'Hosted report' })).toHaveAttribute(
    'href',
    'https://ccrsf-ifx.github.io/fsgc-rnaseq-report/',
  );
  await expect(page.getByRole('link', { name: 'Documentation' }).first()).toHaveAttribute(
    'href',
    'https://ccrsf-ifx.github.io/fsgc-rnaseq-report/docs/latest/',
  );
  await expect(page.getByRole('link', { name: 'webR package snapshot' })).toHaveAttribute(
    'href',
    'https://ccrsf-ifx.github.io/fsgc-rnaseq-report/webr-packages/v0.1.0/',
  );
  await expect(page.getByRole('link', { name: 'Source repository' })).toHaveAttribute(
    'href',
    'https://github.com/CCRSF-IFX/fsgc-rnaseq-report',
  );
});
