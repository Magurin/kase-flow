import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
fs.mkdirSync("artifacts/video", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  recordVideo: { dir: "artifacts/video", size: { width: 1440, height: 1100 } },
  reducedMotion: "reduce",
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const state = async () =>
  await (await page.request.get("http://127.0.0.1:3001/api/state")).json();
const pause = (ms) => page.waitForTimeout(ms);
const click = async (name) => {
  const b = page.getByRole("button", { name, exact: true }).first();
  await b.waitFor();
  await b.click();
};
async function settle() {
  const snapshot = page
    .getByRole("button", { name: "Зафиксировать реестр", exact: true })
    .first();
  await snapshot.waitFor();
  await snapshot.click({ timeout: 600000 });
  await click("Инициировать расчёт");
  const pay = page.getByRole("button", { name: "Выплатить", exact: true });
  await pay.first().waitFor();
  while (await pay.count()) {
    await pay.first().click();
    await page.waitForFunction(() => !document.querySelector(".pending"));
  }
  await page.waitForFunction(() =>
    document.querySelector(".detail-bar")?.textContent?.includes("Исполнено"),
  );
  await pause(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
}
async function schedule(kind, period) {
  await click("Новое действие");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Тип действия" }).click();
  await page
    .getByRole("option", {
      name: ["Купон", "Погашение", "Частичное погашение"][kind],
      exact: true,
    })
    .click();
  if (kind === 0) {
    await dialog.getByRole("combobox", { name: "Купонный период" }).click();
    await page
      .getByRole("option", { name: new RegExp(`^№${period} `) })
      .click();
  }
  await pause(1000);
  await dialog.getByRole("button", { name: "Запланировать", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".overlay"));
  await settle();
}
try {
  await page.goto("http://127.0.0.1:5173");
  await page.getByRole("button", { name: "Новый демо-выпуск" }).waitFor();
  await click("Новый демо-выпуск");
  await page.waitForFunction(() => !document.querySelector(".pending"));
  await page.getByText("Steppe Energy", { exact: false }).first().waitFor();
  await pause(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: "artifacts/dashboard.png", fullPage: true });
  await click("Перевод облигаций");
  await page.getByLabel("Количество облигаций").fill("10");
  await click("Подписать и перевести");
  await page.waitForFunction(() => !document.querySelector(".overlay"));
  await click("Корпоративные действия");
  assert.equal((await state()).holders[0].units, "390");
  await schedule(0, 1);
  console.log("UI: first coupon completed");
  await schedule(2);
  console.log("UI: partial redemption completed");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "artifacts/partial-redemption.png",
    fullPage: true,
  });
  await schedule(0, 2);
  console.log("UI: coupon 2 completed");
  await schedule(0, 3);
  console.log("UI: coupon 3 completed");
  await schedule(0, 4);
  console.log("UI: final coupon completed");
  await schedule(1);
  console.log("UI: final redemption completed");
  const final = await state();
  assert.equal(final.supply, "0");
  assert.equal(final.retired, "1000");
  assert.equal(final.actions.length, 6);
  assert.equal(final.balances.supply, "0");
  assert.ok(final.balances.holders.every((h) => h.bonds === "0"));
  assert.ok(final.actions.every((a) => a.status === 4));
  await click("Журнал операций");
  await page.locator("tbody tr.clickable").first().click();
  await page.getByRole("dialog", { name: "Транзакция Solana" }).waitFor();
  await pause(2000);
  assert.match(
    await page.locator(".dialog pre.logs").innerText(),
    /Settlement attested/,
  );
  await page.screenshot({
    path: "artifacts/transaction-proof.png",
    fullPage: true,
  });
  await click("Закрыть");
  await click("Кабинет инвестора");
  await page.getByRole("heading", { name: "Кабинет инвестора" }).waitFor();
  await page.screenshot({ path: "artifacts/investor.png", fullPage: true });
  fs.writeFileSync(
    "artifacts/demo-audit.json",
    JSON.stringify(
      await (await page.request.get("http://127.0.0.1:3001/api/export")).json(),
      null,
      2,
    ),
  );
  await click("Обзор выпуска");
  await pause(1500);
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto("http://127.0.0.1:5173");
  await mobile.getByText("Steppe Energy", { exact: false }).first().waitFor();
  await mobile.evaluate(() => document.fonts.ready);
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "No horizontal page overflow on mobile",
  );
  await mobile.screenshot({ path: "artifacts/mobile.png", fullPage: true });
  await mobile
    .getByRole("button", { name: "Кабинет инвестора", exact: true })
    .first()
    .click();
  await mobile.getByRole("heading", { name: "Кабинет инвестора" }).waitFor();
  assert.ok(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Investor mobile layout fits",
  );
  await mobile.screenshot({
    path: "artifacts/investor-mobile.png",
    fullPage: true,
  });
  await mobile.close();
  assert.deepEqual(errors, []);
  console.log(
    "UI tests passed: all three scenarios, all four coupons, transfer, RPC proof, mobile layout, no browser errors.",
  );
} finally {
  const video = page.video();
  await context.close();
  if (video) {
    await video.saveAs("artifacts/demo.webm");
  }
  await browser.close();
}
