// Instrument state as returned by /api/state, plus pure helpers that mirror
// the on-chain program rules (integer micro-unit arithmetic, due dates).
export type Row = {
  holder: number;
  units: string;
  retireUnits: string;
  amount: string;
  settled: boolean;
};
export type Action = {
  id: number;
  kind: number;
  period: number;
  bps: number;
  recordAt: number;
  snapshotSlot: string;
  status: number;
  rows: Row[];
};
export type State = {
  face: string;
  couponBps: number;
  frequency: number;
  periods: number;
  issuedAt: number;
  maturity: number;
  supply: string;
  retired: string;
  couponMask: string;
  holders: { index: number; wallet: string; units: string }[];
  actions: Action[];
  slot: number;
  chainTime: number;
  receivedAt?: number;
  observedAt?: string;
  journalStale?: boolean;
  config: {
    state: string;
    programId: string;
    names: string[];
    network: string;
    metadata?: {
      name: string;
      issuer: string;
      symbol: string;
      termsHash?: string;
      document?: string;
    };
  };
  tokens: {
    enabled: boolean;
    bondMint: string;
    cashMint: string;
    vault: string;
  };
  balances: {
    escrow: string;
    supply: string;
    holders: { bonds: string; cash: string; frozen: boolean }[];
  } | null;
  automation: {
    enabled: boolean;
    error: string | null;
    lastRun: string | null;
    closed?: boolean;
  };
  journal: { type: string; label?: string; signature: string; time: string }[];
};

export const KINDS = ["Купон", "Погашение", "Частичное погашение"];
export const STATUS = [
  "Ожидает даты фиксации",
  "Реестр зафиксирован",
  "Расчёт инициирован",
  "Идут выплаты",
  "Исполнено",
];
export const STATUS_TONE = ["warn", "info", "info", "info", "ok"];
export const STEPS = ["Дата фиксации", "Фиксация реестра", "Инициация", "Выплаты"];

export const actionTitle = (a: Action) =>
  a.kind === 0
    ? `Купон №${a.period}`
    : a.kind === 1
      ? "Погашение номинала"
      : `Частичное погашение ${a.bps / 100}%`;
export const actionCode = (a: Action) => `CA-${String(a.id).padStart(3, "0")}`;

export const JOURNAL: Record<string, string> = {
  schedule: "Действие запланировано",
  snapshot: "Реестр зафиксирован",
  initiate: "Расчёт инициирован",
  confirm: "Выплата TEST USD проведена",
  transfer: "Облигации переведены",
  cancel: "Действие отменено",
  withdraw: "Остаток escrow возвращён эмитенту",
  "Instrument setup": "Выпуск размещён",
  "Devnet setup": "Выпуск размещён",
  "Recovered setup": "Размещение сверено с сетью",
  "Test escrow funded": "Escrow пополнен",
  "Wallet claim": "Выплата получена кошельком инвестора",
  "Auto snapshot": "Автопилот: реестр зафиксирован",
  "Auto initiate": "Автопилот: расчёт инициирован",
  "Auto payment": "Автопилот: выплата проведена",
  "Auto coupon scheduled": "Автопилот: купон запланирован",
  "Auto redemption scheduled": "Автопилот: погашение запланировано",
};

export const symbolOf = (s: State) => s.config.metadata?.symbol ?? "STPE.28";
export const nameOf = (s: State) => s.config.metadata?.name ?? "Steppe Energy";
export const holderName = (s: State, i: number) =>
  s.config.names[i] || `Держатель ${i + 1}`;

/** Entitlement per holder, exactly as the program computes it. */
export function entitlement(s: State, units: string, kind: number, bps: number) {
  const q = BigInt(units),
    face = BigInt(s.face);
  return kind === 0
    ? (q * face * BigInt(s.couponBps)) / (10000n * BigInt(s.frequency))
    : (kind === 1 ? q : (q * BigInt(bps)) / 10000n) * face;
}
export const retireUnits = (units: string, kind: number, bps: number) =>
  kind === 1 ? BigInt(units) : kind === 2 ? (BigInt(units) * BigInt(bps)) / 10000n : 0n;
export const total = (s: State, kind: number, bps: number) =>
  s.holders.reduce((n, h) => n + entitlement(s, h.units, kind, bps), 0n);
export const actionSum = (a?: Action) =>
  a?.rows.reduce((n, r) => n + BigInt(r.amount), 0n) ?? 0n;

export const dueOf = (s: State, period: number) =>
  s.issuedAt + Math.floor(((s.maturity - s.issuedAt) * period) / s.periods);
export const couponPaid = (s: State, period: number) =>
  (BigInt(s.couponMask) & (1n << BigInt(period))) !== 0n;
export const unpaidPeriods = (s: State) =>
  Array.from({ length: s.periods }, (_, i) => i + 1).filter(
    (p) => !couponPaid(s, p),
  );
export const allCouponsPaid = (s: State) => unpaidPeriods(s).length === 0;
export const isClosed = (s: State) =>
  s.supply === "0" &&
  allCouponsPaid(s) &&
  s.actions.every((a) => a.status === 4);

/** Current chain time, advanced locally between polls. */
export const chainNow = (s: State, tick: number) =>
  s.chainTime + Math.max(0, Math.floor((tick - (s.receivedAt ?? tick)) / 1000));

export type NextEvent = {
  title: string;
  at: number | null;
  detail: string;
  step?: "snapshot" | "initiate" | "pay" | "schedule";
};
/** The single next thing the operator (or autopilot) has to do. */
export function nextEvent(s: State, now: number): NextEvent {
  const a = s.actions.at(-1);
  if (a && a.status < 4) {
    const title = actionTitle(a);
    if (a.status === 0)
      return now < a.recordAt
        ? { title, at: a.recordAt, detail: "Фиксация реестра держателей" }
        : {
            title,
            at: null,
            detail: "Дата фиксации наступила: зафиксируйте реестр",
            step: "snapshot",
          };
    if (a.status === 1)
      return { title, at: null, detail: "Инициируйте расчёт", step: "initiate" };
    const left = a.rows.filter((r) => !r.settled).length;
    return {
      title,
      at: null,
      detail: `Осталось выплат: ${left} из ${a.rows.length}`,
      step: "pay",
    };
  }
  if (s.supply === "0")
    return { title: "Выпуск погашен", at: null, detail: "Обязательств нет" };
  const period = unpaidPeriods(s)[0];
  if (period)
    return {
      title: `Купон №${period}`,
      at: dueOf(s, period),
      detail: "Плановая дата выплаты купона",
      step: dueOf(s, period) <= now ? "schedule" : undefined,
    };
  return {
    title: "Погашение номинала",
    at: s.maturity,
    detail: "Дата погашения выпуска",
    step: s.maturity <= now ? "schedule" : undefined,
  };
}
