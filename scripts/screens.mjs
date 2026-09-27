// Captures every section of the running UI for design review.
// Usage: node scripts/screens.mjs <out-dir> [issue-id] [width]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] || ".local/screens");
const issue = process.argv[3] || "";
const width = Number(process.argv[4] || 1440);
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width, height: width < 700 ? 844 : 900 },
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173/");
if (issue) {
  await page.evaluate(
    (id) => localStorage.setItem("kase-selected-issue", id),
    issue,
  );
  await page.reload();
}
await page.waitForTimeout(3500);
const sections = [
  "Выпуски",
  "Обзор",
  "Корпоративные действия",
  "Календарь и контроль",
  "Реестр держателей",
  "Журнал операций",
  "Кабинет инвестора",
];
for (const [i, name] of sections.entries()) {
  const tab = page.getByRole("button", { name, exact: false }).first();
  if (await tab.count()) {
    await tab.click();
    await page.waitForTimeout(2500);
  }
  await page.screenshot({
    path: path.join(out, `${i}-${name.replace(/\s+/g, "-")}.png`),
    fullPage: true,
  });
}
// Dialogs: about, new issue wizard (three steps), new corporate action.
const shot = (name) => page.screenshot({ path: path.join(out, `d-${name}.png`) });
await page.getByRole("button", { name: "О прототипе" }).click();
await page.waitForTimeout(500);
await shot("about");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: "Выпуски эмитента" }).click();
await page.getByRole("button", { name: "Новый выпуск" }).click();
await page.waitForTimeout(500);
await shot("wizard-1");
await page.getByRole("button", { name: "Далее" }).click();
await shot("wizard-2");
await page.getByRole("button", { name: "Далее" }).click();
await shot("wizard-3");
await page.keyboard.press("Escape");
const create = page.getByRole("button", { name: "Новое действие" });
await page.getByRole("button", { name: "Обзор выпуска" }).click();
await page.waitForTimeout(1500);
if (await create.isEnabled()) {
  await create.click();
  await page.waitForTimeout(500);
  await shot("action");
}
console.log(errors.length ? errors : "no page errors");
await browser.close();
