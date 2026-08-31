import { expect, test } from '@playwright/test';

// These tests require a running Event Timer server.
// Set PLAYWRIGHT_BASE_URL to run.
const canRun = process.env.PLAYWRIGHT_BASE_URL;

test.describe('Display flow', () => {
  test.skip(!canRun, 'PLAYWRIGHT_BASE_URL not set — skipped in unit-test CI');

  test('open pairing screen', async ({ page }) => {
    await page.goto('/pair');
    await expect(page.getByText('Enter pairing code')).toBeVisible();
  });
});
