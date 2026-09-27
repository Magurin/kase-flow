// Read-only Devnet interface walkthrough, not a full lifecycle recording.
import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
fs.mkdirSync("artifacts/video", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1100 },
  recordVideo: { dir: "artifacts/video", size: { width: 1440, height: 1100 } },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.getByText("Steppe Energy", { exact: false }).first().waitFor();
  const result = await (
    await page.request.get("http://127.0.0.1:3001/api/state")
  ).json();
  assert.equal(result.config.network, "devnet");
  assert.equal(
    result.config.programId,
    "4r48EMFeGkNMyrhEvoZgkmQJrdW9VjaatRpH9y677nq1",
  );
  assert.equal(await page.getByLabel("Сеть", { exact: true }).count(), 0);
  assert.equal(
    await page.getByRole("button", { name: "К следующей дате" }).count(),
    0,
  );
  assert.equal(
    (
      await page.request.post("http://127.0.0.1:3001/api/clock", {
        data: { target: "maturity" },
      })
    ).status(),
    404,
  );
  for (const [title, file] of [
    ["Обзор выпуска", "dashboard"],
    ["Кабинет инвестора", "investor"],
    ["Журнал операций", "journal"],
  ]) {
    await page.getByRole("button", { name: title, exact: true }).first().click();
    await page.waitForTimeout(3000);
    await page.screenshot({
      path: `artifacts/devnet-${file}.png`,
      fullPage: true,
    });
  }
  await page.locator("tbody tr.clickable").first().click();
  await page.getByRole("dialog", { name: "Транзакция Solana" }).waitFor();
  const explorer = page.getByRole("link", {
    name: "Открыть в Solana Explorer",
  });
  assert.match(await explorer.getAttribute("href"), /cluster=devnet/);
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: "artifacts/devnet-transaction.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Кабинет инвестора", exact: true })
    .first()
    .click();
  await page.evaluate(() => document.fonts.ready);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  await page.screenshot({
    path: "artifacts/devnet-mobile.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "artifacts/devnet-ui-check.json",
    JSON.stringify(
      {
        network: result.config.network,
        state: result.config.state,
        program: result.config.programId,
        checks: [
          "Devnet default at 5173",
          "no network selector",
          "no clock controls or endpoint",
          "Explorer link",
          "mobile width 390",
          "no browser errors",
        ],
      },
      null,
      2,
    ),
  );
  console.log("Devnet-only UI smoke checks passed.");
} finally {
  const video = page.video();
  await context.close();
  if (video) await video.saveAs("artifacts/devnet-tour.webm");
  await browser.close();
}
