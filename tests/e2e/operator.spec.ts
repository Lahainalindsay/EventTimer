import { expect, test } from '@playwright/test';

// These tests require a running Event Timer server with test credentials.
// Set PLAYWRIGHT_BASE_URL, E2E_TEST_EMAIL, E2E_TEST_PASSWORD to run.
const canRun = process.env.PLAYWRIGHT_BASE_URL && process.env.E2E_TEST_EMAIL;

test.describe('Operator flow', () => {
  test.skip(!canRun, 'E2E_TEST_EMAIL not set — skipped in unit-test CI');

  test('login and open dashboard', async ({ page }) => {
    await page.goto('/');
    await page.fill('[name=email]', process.env.E2E_TEST_EMAIL!);
    await page.fill('[name=password]', process.env.E2E_TEST_PASSWORD!);
    await page.click('button[type=submit]');
    await expect(page).toHaveURL(/dashboard|events/);
  });
});
