import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';

const dock = (page: Page) => page.getByRole('complementary', { name: '行程助理' });
const stops = (page: Page) => page.locator('ol.stops > li');

async function openDock(page: Page) {
  await page.getByRole('button', { name: '行程助理' }).click();
  await expect(dock(page)).toBeVisible();
}

async function send(page: Page, text: string) {
  await dock(page).getByLabel('訊息').fill(text);
  await dock(page).getByRole('button', { name: '送出', exact: true }).click();
}

async function times(page: Page) {
  return stops(page).locator('.time').allTextContents();
}

test('loads the trip with the dock closed and names the ACP demo peer in mock mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '東京・箱根・河口湖 家族自駕五日' })).toBeVisible();
  await expect(page.getByText('11/13–11/17 · 5 天 · 5 位大人')).toBeVisible();
  await expect(dock(page)).toHaveCount(0);
  await openDock(page);
  await expect(dock(page).getByText('agent-panel 透過 ACP 接上內建的示範 peer')).toBeVisible();
  await expect(page.getByText('額外 API 費用 $0')).toHaveCount(0);
});

test('plans 11/15 from a selected day, late start and seated dinner, without reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^11\/15 週日/ }).first().click();
  await expect(stops(page)).toHaveCount(1);
  await page.evaluate(() => Object.assign(window, { sameDocument: true }));
  await openDock(page);
  await expect(dock(page).getByText('已選：11/15 箱根 → 河口湖')).toBeVisible();
  await send(page, '11/15 從箱根到河口湖，不要太早出門，晚餐要坐著吃');
  await dock(page).getByRole('button', { name: '允許寫入' }).click();
  await expect(dock(page).getByText('完成', { exact: true })).toBeVisible();

  await expect.poll(async () => (await times(page)).length).toBeGreaterThan(3);
  const [first] = await times(page);
  expect(first && first >= '10:00').toBe(true);
  const dinner = stops(page).filter({ has: page.locator('.time', { hasText: '18:30' }) });
  await expect(dinner).toContainText('用餐');
  await expect(dinner).toContainText('座位');
  expect(await page.evaluate(() => 'sameDocument' in window)).toBe(true);
});

test('replaces only the selected stop with an onsen', async ({ page }) => {
  await page.goto('/');
  const before = await stops(page).evaluateAll((items) =>
    items.map((item) => [item.getAttribute('data-stop-id'), item.textContent]),
  );
  await page.getByRole('heading', { name: '新宿御苑' }).click();
  await openDock(page);
  await expect(dock(page).getByText('已選：新宿御苑')).toBeVisible();
  await send(page, '這裡換成溫泉');
  await dock(page).getByRole('button', { name: '允許寫入' }).click();

  const card = page.locator('[data-stop-id="d1-gyoen"]');
  await expect(card).toContainText('溫泉');
  await expect(card.getByLabel('地點')).not.toHaveValue('新宿御苑');
  await expect(card.getByLabel('時間')).toHaveValue('14:00');
  const after = await stops(page).evaluateAll((items) =>
    items.map((item) => [item.getAttribute('data-stop-id'), item.textContent]),
  );
  expect(after.filter(([id]) => id !== 'd1-gyoen')).toEqual(before.filter(([id]) => id !== 'd1-gyoen'));
});

test('asks transport and budget before planning, then writes the day', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^11\/15 週日/ }).first().click();
  await openDock(page);
  await send(page, '幫我排 11/15');
  await expect(dock(page).getByText('先確認一下：這天要自駕還是搭電車？預算抓多少？')).toBeVisible();
  await expect(dock(page).getByRole('radio', { name: '自駕' })).toBeVisible();
  await dock(page).getByRole('radio', { name: '電車' }).check();
  await dock(page).getByRole('radio', { name: '適中' }).check();
  await dock(page).getByRole('button', { name: '送出回答' }).click();
  await expect(dock(page).getByText(/已回答/)).toBeVisible();
  await dock(page).getByRole('button', { name: '允許寫入' }).click();

  await expect.poll(async () => (await times(page)).length).toBeGreaterThan(3);
  await expect(page.locator('ol.stops .connector', { hasText: /電車|巴士/ }).first()).toBeVisible();
});

test('reorders with the keyboard and drags a stop onto another day', async ({ page }) => {
  await page.goto('/');
  const ids = () => stops(page).evaluateAll((items) => items.map((item) => item.getAttribute('data-stop-id')));
  await page.locator('[data-stop-id="d1-lunch"]').focus();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(ids).toEqual(['d1-haneda', 'd1-lunch', 'd1-hotel', 'd1-gyoen', 'd1-asakusa', 'd1-dinner']);
  await expect(page.locator('[data-stop-id="d1-lunch"]')).toBeFocused();

  await page.locator('[data-stop-id="d1-asakusa"]').dragTo(page.getByRole('button', { name: /^11\/14 週六/ }).first());
  await expect.poll(ids).not.toContain('d1-asakusa');
  await page.reload();
  await page.getByRole('button', { name: /^11\/14 週六/ }).first().click();
  await expect(page.locator('[data-stop-id="d1-asakusa"]')).toBeVisible();
});

test('an edit made on a stale board does not overwrite what the agent wrote', async ({ page }) => {
  const file = path.resolve('e2e/.data/trips/japan-family-2026.json');
  await page.route('**/api/events', (route) => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: /^11\/16 週一/ }).first().click();
  await page.locator('[data-stop-id="d4-oishi"]').click();

  const trip = JSON.parse(await readFile(file, 'utf8'));
  trip.days[3].stops.find((stop: { id: string }) => stop.id === 'd4-chureito').notes = '代理剛寫的備註';
  await writeFile(file, `${JSON.stringify(trip, null, 2)}\n`);

  const cost = page.getByLabel('費用（全團）');
  await cost.fill('4321');
  await cost.press('Enter');
  await expect(page.getByText(/沒有存到/)).toBeVisible();
  await expect(page.getByText('代理剛寫的備註')).toBeVisible();
  const saved = JSON.parse(await readFile(file, 'utf8'));
  const stop = (id: string) => saved.days[3].stops.find((entry: { id: string }) => entry.id === id);
  expect(stop('d4-chureito').notes).toBe('代理剛寫的備註');
  expect(stop('d4-oishi').cost).toBe(0);
});

test('the map follows a quick switch to another day', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.pin').first()).toBeVisible();
  await page.getByRole('button', { name: /^11\/14 週六/ }).first().click();
  await page.getByRole('button', { name: /^11\/15 週日/ }).first().click();
  const map = await page.getByRole('region', { name: '地圖' }).boundingBox();
  // The map fits the day's pins, so their outer box sits in the middle of the map.
  const offCentre = () =>
    page.locator('.pin').evaluateAll((pins) => {
      const xs = pins.map((pin) => {
        const box = pin.getBoundingClientRect();
        return box.x + box.width / 2;
      });
      return (Math.min(...xs) + Math.max(...xs)) / 2;
    });
  await expect.poll(async () => Math.abs((await offCentre()) - (map!.x + map!.width / 2))).toBeLessThan(40);
});
