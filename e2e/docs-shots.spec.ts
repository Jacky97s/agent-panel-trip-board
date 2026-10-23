import { expect, type Page, test } from '@playwright/test';

const dock = (page: Page) => page.getByRole('complementary', { name: '行程助理' });

async function openDock(page: Page) {
  await page.getByRole('button', { name: '行程助理' }).click();
  await expect(dock(page)).toBeVisible();
}

async function send(page: Page, text: string) {
  await dock(page).getByLabel('訊息').fill(text);
  await dock(page).getByRole('button', { name: '送出', exact: true }).click();
}

async function shoot(page: Page, name: string) {
  // Wait for map tiles and for the highlight on cards an agent just changed to fade.
  await page.waitForLoadState('networkidle');
  await expect(page.locator('.stop.is-flash')).toHaveCount(0);
  await page.screenshot({ path: `docs/${name}.png` });
}

test.describe.configure({ mode: 'serial' });

test('board', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pin').first()).toBeVisible();
  await shoot(page, 'board');
});

test('phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.pin').first()).toBeVisible();
  await shoot(page, 'mobile');
});

test('agent plans the selected day', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^11\/15 週日/ }).first().click();
  await openDock(page);
  await send(page, '11/15 從箱根到河口湖，不要太早出門，晚餐要坐著吃');
  await expect(dock(page).getByRole('button', { name: '允許寫入' })).toBeVisible();
  await shoot(page, 'permission');
  await dock(page).getByRole('button', { name: '允許寫入' }).click();
  await expect(dock(page).getByText('完成', { exact: true })).toBeVisible();
  await expect.poll(() => page.locator('ol.stops > li').count()).toBeGreaterThan(3);
  await shoot(page, 'agent-plan');
});

test('agent changes only the selected stop', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^11\/14 週六/ }).first().click();
  await page.getByRole('heading', { name: '箱根湯本 商店街' }).click();
  await openDock(page);
  await send(page, '這裡換成溫泉');
  await dock(page).getByRole('button', { name: '允許寫入' }).last().click();
  await expect(page.locator('[data-stop-id="d2-yumoto"]')).toContainText('溫泉');
  await shoot(page, 'onsen');
});

test('agent asks before planning', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^11\/15 週日/ }).first().click();
  await openDock(page);
  await send(page, '幫我排 11/15');
  await expect(dock(page).getByRole('radio', { name: '自駕' })).toBeVisible();
  await shoot(page, 'question');
});
