import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { PublicKey, Keypair } from "@solana/web3.js";

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}
const read = (file, fallback) =>
  fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : fallback;
const text = (value, label, max = 100) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw Error(`Проверьте поле «${label}»`);
  return value.trim();
};
const integer = (n, min, max, label) => {
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw Error(`${label}: допустимо от ${min} до ${max}`);
  return n;
};
export function micro(value) {
  if (typeof value !== "string" || !/^\d{1,9}(\.\d{1,6})?$/.test(value))
    throw Error("Номинал: положительное число, до 6 знаков после точки");
  const [whole, fraction = ""] = value.split(".");
  const n = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  if (n <= 0n) throw Error("Номинал должен быть больше нуля");
  return n;
}
export function normalizeDraft(input) {
  const d = {
    issuer: text(input.issuer, "Эмитент"),
    name: text(input.name, "Название"),
    symbol: text(input.symbol, "Тикер", 16).toUpperCase(),
    face: String(input.face),
    couponBps: integer(input.couponBps, 0, 10000, "Купон, базисные пункты"),
    frequency: integer(input.frequency, 1, 12, "Частота выплат"),
    periods: integer(input.periods, 1, 12, "Количество купонов"),
    timeMode: input.timeMode === "calendar" ? "calendar" : "demo",
    supply: integer(input.supply, 1, 1000000, "Объём выпуска"),
    document:
      typeof input.document === "string"
        ? input.document.trim().slice(0, 4000)
        : "",
    applications: [],
  };
  // Coupons pay couponBps / frequency per period, so the nominal tenor is
  // periods / frequency years. Calendar mode runs that tenor in real time;
  // demo mode compresses it into minutes on Devnet without changing amounts.
  d.duration =
    d.timeMode === "calendar"
      ? calendarDuration(d)
      : integer(input.duration, 300, DEMO_MAX, "Длительность демо, секунд");
  if (!/^[A-Z0-9._-]+$/.test(d.symbol))
    throw Error("Тикер: латинские буквы, цифры, точка, дефис");
  micro(d.face);
  if (
    !Array.isArray(input.applications) ||
    !input.applications.length ||
    input.applications.length > 16
  )
    throw Error("Реестр должен содержать от 1 до 16 инвесторов");
  const wallets = new Set();
  d.applications = input.applications.map((a) => {
    const wallet = a.wallet ? new PublicKey(a.wallet).toBase58() : "";
    if (
      wallet &&
      (!PublicKey.isOnCurve(new PublicKey(wallet).toBytes()) ||
        wallets.has(wallet))
    )
      throw Error("Кошелёк должен быть уникальным адресом инвестора");
    if (wallet) wallets.add(wallet);
    return {
      name: text(a.name, "Имя инвестора"),
      wallet,
      units: integer(a.units, 1, 1000000, "Количество облигаций"),
      admitted: a.admitted === true,
    };
  });
  if (d.applications.reduce((n, a) => n + a.units, 0) !== d.supply)
    throw Error("Распределение должно совпадать с объёмом выпуска");
  const budget = draftBudget(d);
  if (BigInt(budget.total) > 18446744073709551615n)
    throw Error("Бюджет превышает допустимый размер");
  return d;
}
export const YEAR = 31_536_000;
export const DEMO_MAX = 86_400;
export const calendarDuration = (d) =>
  Math.round((d.periods * YEAR) / d.frequency);
/**
 * Escrow needed for every coupon and full principal. Each holder's coupon is
 * rounded down separately; transfers can regroup units and gain up to one
 * micro-unit per holder per period, so that margin is reserved.
 */
export function escrowBudget({ units, face, couponBps, frequency, periods }) {
  face = BigInt(face);
  const principal = units.reduce((n, u) => n + BigInt(u), 0n) * face;
  const coupon = units.reduce(
    (n, u) =>
      n + (BigInt(u) * face * BigInt(couponBps)) / (10000n * BigInt(frequency)),
    0n,
  );
  const reserve = BigInt(units.length) * BigInt(periods);
  return {
    principal,
    coupon,
    reserve,
    total: principal + coupon * BigInt(periods) + reserve,
  };
}
export function draftBudget(d) {
  const b = escrowBudget({
    units: d.applications.map((a) => a.units),
    face: micro(d.face),
    couponBps: d.couponBps,
    frequency: d.frequency,
    periods: d.periods,
  });
  return {
    principal: String(b.principal),
    coupon: String(b.coupon),
    reserve: String(b.reserve),
    total: String(b.total),
    tenorYears: d.periods / d.frequency,
  };
}
export const termsHash = (d) =>
  createHash("sha256").update(JSON.stringify(d)).digest("hex");

export class WorkspaceStore {
  constructor(root) {
    this.root = root;
    this.file = path.join(root, "workspace.json");
    this.data = read(this.file, { version: 1, drafts: [], issues: [] });
    // A restarted process must never silently repeat an interrupted issuance.
    for (const d of this.data.drafts)
      if (d.status === "publishing") {
        d.status = "needs_review";
        d.error =
          "Сервер перезапущен во время выпуска. Проверьте сохранённый аккаунт в Explorer; повторный выпуск заблокирован.";
      }
    this.migrate();
    this.save();
  }
  save() {
    writeJson(this.file, this.data);
  }
  dir(id) {
    if (!this.data.issues.some((x) => x.id === id))
      throw Error("Выпуск не найден");
    return path.join(this.root, "issues", id);
  }
  context(id) {
    const dir = this.dir(id);
    return { id, dir, config: read(path.join(dir, "config.json")) };
  }
  migrate() {
    const config = read(path.join(this.root, "config.json"), null);
    if (!config || this.data.issues.some((x) => x.id === config.state)) return;
    this.register(
      config,
      { issuer: "Steppe Energy", name: "Steppe Energy", symbol: "STPE.28" },
      read(path.join(this.root, "journal.json"), []),
      read(path.join(this.root, "automation.json"), {
        enabled: false,
        error: null,
        lastRun: null,
      }),
    );
    const dir = this.dir(config.state);
    (config.wallets || []).forEach((wallet, i) => {
      const file = path.join(this.root, `holder-${i}.json`);
      if (fs.existsSync(file)) {
        const key = read(file);
        if (
          Keypair.fromSecretKey(Uint8Array.from(key)).publicKey.toBase58() ===
          wallet
        )
          writeJson(path.join(dir, `holder-${i}.json`), key);
      }
    });
  }
  register(
    config,
    metadata,
    journal = [],
    automation = { enabled: false, error: null, lastRun: null },
  ) {
    const id = config.state,
      dir = path.join(this.root, "issues", id);
    if (this.data.issues.some((x) => x.id === id))
      throw Error("Выпуск уже зарегистрирован");
    config.metadata = metadata;
    writeJson(path.join(dir, "config.json"), config);
    writeJson(path.join(dir, "journal.json"), journal);
    writeJson(path.join(dir, "automation.json"), automation);
    this.data.issues.push({
      id,
      ...metadata,
      createdAt: config.createdAt,
      status: "active",
    });
    this.save();
  }
  getDraft(id) {
    const d = this.data.drafts.find((x) => x.id === id);
    if (!d) throw Error("Черновик не найден");
    return d;
  }
  saveDraft(input, id, revision) {
    const terms = normalizeDraft(input);
    let d;
    if (id) {
      d = this.getDraft(id);
      if (!["draft", "approved"].includes(d.status))
        throw Error(
          "Условия опубликованного или запускаемого выпуска неизменяемы",
        );
      if (d.revision !== revision)
        throw Error("Черновик изменён в другой вкладке. Обновите страницу.");
      d.terms = terms;
      d.revision++;
      d.status = "draft";
      d.approval = null;
    } else {
      d = {
        id: randomUUID(),
        revision: 1,
        status: "draft",
        terms,
        history: [],
        createdAt: new Date().toISOString(),
      };
      this.data.drafts.unshift(d);
    }
    d.updatedAt = new Date().toISOString();
    d.history.push({
      event: "Сохранены условия",
      at: d.updatedAt,
      revision: d.revision,
      hash: termsHash(terms),
    });
    this.save();
    return d;
  }
  approve(id, revision) {
    const d = this.getDraft(id);
    if (d.status !== "draft" || d.revision !== revision)
      throw Error("Черновик изменён или уже утверждён");
    if (d.terms.applications.some((a) => !a.admitted))
      throw Error("Подтвердите допуск каждого инвестора");
    d.approval = {
      at: new Date().toISOString(),
      hash: termsHash(d.terms),
      revision: d.revision,
    };
    d.status = "approved";
    d.history.push({
      event: "Проверено оператором (локальный прототип)",
      ...d.approval,
    });
    this.save();
    return d;
  }
  beginPublish(id, revision) {
    const d = this.getDraft(id);
    if (
      d.status !== "approved" ||
      d.revision !== revision ||
      d.approval.hash !== termsHash(d.terms)
    )
      throw Error("Сначала проверьте и утвердите текущую версию");
    d.status = "publishing";
    d.startedAt = new Date().toISOString();
    this.save();
    return d;
  }
}
