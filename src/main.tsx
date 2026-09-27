import React, { useEffect, useState } from "react";
import { Workspace } from "./Workspace";
import { Lifecycle, ActionPreview } from "./Lifecycle";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Blocks,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileText,
  Fingerprint,
  Landmark,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Users,
  Wallet,
  X,
  RotateCcw,
  ArrowLeftRight,
  Copy,
  Radio,
} from "lucide-react";
import "./style.css";
import "./kase-theme.css";
import "./workspace.css";
import { CustomSelect } from "./CustomSelect";
import { Investor, DemoControls } from "./Investor";
import { Buffer } from "buffer";
(globalThis as any).Buffer = Buffer;
type Row = {
  holder: number;
  units: string;
  retireUnits: string;
  amount: string;
  settled: boolean;
};
type Action = {
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
const money = (micro: string | bigint) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
  }).format(Number(micro) / 1e6);
const short = (v: string) => `${v.slice(0, 5)}…${v.slice(-5)}`;
const dates = (n: number) =>
  new Date(n * 1000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
const labels = [
  "Купонная выплата",
  "Погашение облигации",
  "Частичное погашение",
];
const statuses = [
  "Ожидает record date",
  "Права зафиксированы",
  "Расчёт инициирован",
  "Расчёт выполняется",
  "Завершено",
];
const journalLabels: Record<string, string> = {
  schedule: "Действие запланировано",
  snapshot: "Права держателей зафиксированы",
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
  "Auto snapshot": "Автопилот: права зафиксированы",
  "Auto initiate": "Автопилот: расчёт инициирован",
  "Auto payment": "Автопилот: выплата проведена",
  "Auto coupon scheduled": "Автопилот: купон запланирован",
  "Auto redemption scheduled": "Автопилот: погашение запланировано",
};
const sum = (a?: Action) =>
  a?.rows.reduce((n, r) => n + BigInt(r.amount), 0n) ?? 0n;
const names = [
  "Обзор",
  "Корпоративные действия",
  "Реестр держателей",
  "Журнал операций",
  "Кабинет инвестора",
  "Выпуски",
  "Календарь и контроль",
];
const icons = [
  LayoutDashboard,
  AudioLines,
  Users,
  FileText,
  Wallet,
  Landmark,
  Clock3,
];
export function App({
  issueId,
  onSelect,
  startPage = 5,
}: {
  issueId: string;
  onSelect: (id: string) => void;
  startPage?: number;
}) {
  const [page, setPage] = useState(startPage),
    [s, setS] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState<"action" | "transfer" | "about" | null>(null),
    [kind, setKind] = useState(0),
    [period, setPeriod] = useState(1),
    [bps, setBps] = useState(2000),
    [query, setQuery] = useState(""),
    [selected, setSelected] = useState<number | null>(null),
    [tx, setTx] = useState<any>(null),
    [transfer, setTransfer] = useState({ from: 0, to: 1, units: 10 }),
    [tick, setTick] = useState(Date.now()),
    [cancelling, setCancelling] = useState(false);
  // Every request names its instrument explicitly; the server default
  // profile is only a fallback for CLI scripts.
  const scope = (): Record<string, string> => {
    const id = s?.config.state || issueId;
    return id ? { "X-Instrument-ID": id } : {};
  };
  async function refresh() {
    try {
      const r = await fetch("/api/state", {
        headers: issueId ? { "X-Instrument-ID": issueId } : {},
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      setS({ ...v, receivedAt: Date.now() });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    // The API caches chain reads for up to 8 s; poll at half that and keep
    // countdowns ticking every second on their own.
    const poll = setInterval(() => void refresh(), 4000);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 6500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  async function act(body: object) {
    setBusy(true);
    try {
      const r = await fetch("/api/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...scope(),
        },
        body: JSON.stringify(body),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      setToast("Транзакция подтверждена в Solana");
      await refresh();
      setModal(null);
      return true;
    } catch (e) {
      setToast((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function newDemo(wallet?: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/demo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...scope(),
        },
        body: JSON.stringify({ wallet }),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      setSelected(null);
      await refresh();
      setToast("Создан новый тестовый выпуск");
      if (v.issueId) onSelect(v.issueId);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const current = s?.actions.at(-1),
    action =
      selected === null ? current : s?.actions.find((a) => a.id === selected),
    active = !!current && current.status < 4;
  // Chain time advances locally between polls so countdowns stay smooth.
  const now = s
    ? s.chainTime +
      Math.max(0, Math.floor((tick - (s.receivedAt ?? tick)) / 1000))
    : Math.floor(tick / 1000);
  const total = s ? BigInt(s.supply) * BigInt(s.face) : 0n;
  const paid =
    s?.actions
      .flatMap((a) => a.rows)
      .filter((r) => r.settled)
      .reduce((v, r) => v + BigInt(r.amount), 0n) ?? 0n;
  const expected = s
    ? kind === 0
      ? s.holders.reduce(
          (n, h) =>
            n +
            (BigInt(h.units) * BigInt(s.face) * BigInt(s.couponBps)) /
              (10000n * BigInt(s.frequency)),
          0n,
        )
      : s.holders.reduce(
          (n, h) =>
            n +
            (kind === 1
              ? BigInt(h.units)
              : (BigInt(h.units) * BigInt(bps)) / 10000n) *
              BigInt(s.face),
          0n,
        )
    : 0n;
  const recordAt = s
    ? Math.max(
        now + 30,
        kind === 0
          ? s.issuedAt +
              Math.floor(((s.maturity - s.issuedAt) * period) / s.periods)
          : kind === 1
            ? s.maturity
            : now + 4,
      )
    : now + 4;
  const allCoupons = s
    ? BigInt(s.couponMask) === (1n << BigInt(s.periods + 1)) - 2n
    : false;
  // Mirrors the program check: a partial redemption must retire a whole bond.
  const retiresWholeBond =
    !!s && s.holders.some((h) => BigInt(h.units) * BigInt(bps) >= 10000n);
  function openAction(k = 0) {
    setKind(k === 0 && allCoupons ? 1 : k);
    setPeriod(
      s
        ? (Array.from({ length: s.periods }, (_, i) => i + 1).find(
            (p) => (BigInt(s.couponMask) & (1n << BigInt(p))) === 0n,
          ) ?? 1)
        : 1,
    );
    setModal("action");
  }
  async function inspect(signature: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/transaction/" + signature);
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      setTx({ signature, ...v });
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const symbol = s?.config.metadata?.symbol ?? "STPE.28";
  const issueName = s?.config.metadata?.name ?? "Steppe Energy";
  const transferReason =
    s &&
    (s.holders.length < 2
      ? "Для перевода нужны два держателя"
      : now >= s.maturity
        ? "После наступления срока переводы заблокированы"
        : active && now >= current.recordAt
          ? "Переводы заблокированы до завершения текущего действия"
          : "");
  return (
    <div className="shell">
      <header className="exchange-header">
        <div className="exchange-masthead">
          <a
            className="exchange-brand"
            href="#"
            onClick={(event) => {
              event.preventDefault();
              setPage(0);
            }}
            aria-label="KASE Flow — обзор"
          >
            <svg viewBox="0 0 40 40" aria-hidden="true">
              <path d="M2 4h34L2 38Z" fill="currentColor" />
              <path d="M15 4h21L15 25Z" fill="#70ca49" />
            </svg>
            <span>
              KASE<span className="brand-flow">flow</span>
            </span>
          </a>
          <div className="exchange-description">
            Сервис корпоративных действий
            <small>Токенизированные финансовые инструменты</small>
          </div>
          <div className="exchange-utilities">
            <button
              className="exchange-about"
              onClick={() => setModal("about")}
            >
              <CircleHelp size={17} />
              <span>О прототипе</span>
            </button>
            <button
              className="button primary"
              aria-label="Подключить кошелёк"
              onClick={() => setPage(4)}
            >
              <Wallet size={17} />
              <span className="wallet-label-full">Подключить кошелёк</span>
              <span className="wallet-label-short" aria-hidden="true">
                Кошелёк
              </span>
            </button>
          </div>
        </div>
        <div className="exchange-nav-wrap">
          <nav className="exchange-nav" aria-label="Разделы платформы">
            {[5, 0, 1, 6, 2, 3, 4].map((i) => {
              const n = names[i];
              const Icon = icons[i];
              return (
                <button
                  className={page === i ? "active" : ""}
                  aria-current={page === i ? "page" : undefined}
                  key={n}
                  onClick={() => setPage(i)}
                >
                  <Icon size={17} />
                  {n}
                  {i === 1 && s && (
                    <span className="nav-count">{s.actions.length}</span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>
      <div className="main-wrap">
        <div className="topbar">
          <div>
            Рабочее пространство <ChevronRight size={14} />
            <b>{names[page]}</b>
          </div>
          <div className="exchange-network">
            <span
              className={error ? "connection-dot offline" : "connection-dot"}
            />
            Solana Devnet
            <span className="network-detail">
              {error
                ? "Подключение недоступно"
                : s
                  ? `Слот ${s.slot.toLocaleString()}`
                  : "Подключение…"}
            </span>
          </div>
        </div>
        <main>
          {s && page !== 5 && (
            <div className="selected-issue">
              <span>
                <b>{symbol}</b> · {issueName}{" "}
                <small>{s.config.metadata?.issuer}</small>
              </span>
              <button className="text-button" onClick={() => setPage(5)}>
                Все выпуски <ArrowRight size={15} />
              </button>
            </div>
          )}

          <div className="page-heading">
            <div>
              <div className="eyebrow">
                ИНФРАСТРУКТУРА КОРПОРАТИВНЫХ ДЕЙСТВИЙ
              </div>
              <h1>
                {page === 0
                  ? "Весь жизненный цикл. Под контролем."
                  : names[page]}
              </h1>
              <p>
                {page === 0
                  ? "От фиксации держателей до подтверждения расчётов — в одном потоке."
                  : page === 1
                    ? "Планируйте события, фиксируйте права и отслеживайте исполнение."
                    : page === 2
                      ? "Право на актив подтверждено балансом в программе Solana."
                      : page === 4
                        ? "Баланс облигаций, ваши начисления и получение выплат."
                        : page === 5
                          ? "Подготовка, размещение и обслуживание выпусков."
                          : page === 6
                            ? "Обязательства, бюджет выплат и сверка результатов."
                            : "Проверяемая история каждой операции в Solana."}
              </p>
            </div>
            {page !== 5 && (
              <div className="heading-action">
                <button
                  className="button primary"
                  disabled={!s || busy || active}
                  onClick={() =>
                    s?.supply === "0" ? setPage(5) : openAction()
                  }
                >
                  <Plus size={17} />
                  {s?.supply === "0"
                    ? "Перейти к выпускам"
                    : "Создать действие"}
                </button>
                {active && (
                  <small className="disabled-reason">
                    Завершите текущее корпоративное действие
                  </small>
                )}
              </div>
            )}
          </div>
          {error && (
            <div className="error-banner">
              <b>Не удалось обновить данные Solana.</b>
              <span>{error}</span>
              <button onClick={() => void refresh()}>Повторить</button>
            </div>
          )}
          <div className="demo-note">
            <Flask />
            <span>
              <b>Демонстрационный выпуск.</b> Транзакции исполняются в Solana
              Devnet. Выплаты — в TEST USD, облигации — Token-2022. Реальные
              деньги не используются.
            </span>
            <button onClick={() => setModal("about")}>
              Что реализовано <ArrowUpRight size={14} />
            </button>
          </div>
          {page === 5 && (
            <Workspace
              activeId={s?.config.state ?? issueId}
              onSelect={(id) => {
                setPage(0);
                onSelect(id);
              }}
            />
          )}
          {s ? (
            <>
              {page !== 5 && (
                <DemoControls
                  s={s}
                  refresh={refresh}
                  notify={setToast}
                  busy={busy}
                />
              )}
              {page === 6 && (
                <Lifecycle
                  s={s}
                  onAction={openAction}
                  refresh={refresh}
                  notify={setToast}
                />
              )}
              {page === 4 && (
                <Investor
                  s={s}
                  refresh={refresh}
                  notify={setToast}
                  newDemo={newDemo}
                />
              )}
              {page === 0 && (
                <>
                  <section className="instrument-card">
                    <div className="instrument-content">
                      <div className="instrument-top">
                        <span className="instrument-label">
                          <Landmark size={15} /> ТЕСТОВАЯ КОРПОРАТИВНАЯ
                          ОБЛИГАЦИЯ
                        </span>
                        <span className="badge dark">
                          <span />
                          {s.supply === "0" ? "Погашен" : "В обращении"}
                        </span>
                      </div>
                      <h2>{issueName}</h2>
                      <div className="instrument-sub">
                        {symbol} <span>·</span> TEST USD <span>·</span>{" "}
                        Программный токен Solana
                      </div>
                      <div className="terms">
                        <div>
                          <small>Номинал</small>
                          <strong>
                            {money(s.face)}
                            <span> / токен</span>
                          </strong>
                        </div>
                        <div>
                          <small>Годовой купон</small>
                          <strong>
                            {(s.couponBps / 100).toFixed(2)}
                            <span>%</span>
                          </strong>
                        </div>
                        <div>
                          <small>Периодичность</small>
                          <strong>{s.frequency} в год</strong>
                        </div>
                        <div>
                          <small>Срок обращения</small>
                          <strong>
                            {Math.round(
                              (s.maturity - s.issuedAt) / 60,
                            ).toLocaleString()}{" "}
                            мин.
                            <span> / Devnet</span>
                          </strong>
                        </div>
                      </div>
                    </div>
                    <div className="exchange-art" aria-hidden="true">
                      <svg viewBox="0 0 280 230">
                        <path d="M40 0h240L40 230Z" fill="#028a29" />
                        <path d="M125 0h155L125 150Z" fill="#65c647" />
                        <path d="M125 92h155L125 242Z" fill="#c7e7bb" />
                      </svg>
                      <span>ЦИФРОВЫЕ АКТИВЫ / SOLANA</span>
                    </div>
                  </section>
                  <section className="metrics">
                    <Metric
                      label="Номинал в обращении"
                      value={money(total)}
                      foot={`${Number(s.supply).toLocaleString()} токенов × ${money(s.face)}`}
                      icon={<Wallet size={19} />}
                    />
                    <Metric
                      label="Держатели инструмента"
                      value={String(
                        s.holders.filter((h) => BigInt(h.units) > 0n).length,
                      ).padStart(2, "0")}
                      foot="Верифицируемый реестр"
                      icon={<Users size={19} />}
                    />
                    <Metric
                      label="Подтверждённые расчёты"
                      value={money(paid)}
                      foot="Выплаты TEST USD в Devnet"
                      icon={<ArrowDownLeft size={19} />}
                    />
                    <Metric
                      label="Корпоративные действия"
                      value={String(s.actions.length).padStart(2, "0")}
                      foot={`${s.actions.filter((a) => a.status === 4).length} завершено · ${active ? 1 : 0} в работе`}
                      icon={<AudioLines size={19} />}
                    />
                  </section>
                </>
              )}
              {(page === 0 || page === 1) && (
                <div className="content-grid">
                  <section className="panel action-panel">
                    <div className="panel-head">
                      <div>
                        <h3>
                          {page === 0
                            ? "Корпоративные действия"
                            : "События выпуска"}
                          <span className="count">{s.actions.length}</span>
                        </h3>
                        <p>Управляйте исполнением, шаг за шагом</p>
                      </div>
                      {page === 0 && (
                        <button
                          className="text-button"
                          onClick={() => setPage(1)}
                        >
                          Все действия <ArrowRight size={15} />
                        </button>
                      )}
                    </div>
                    <div className="action-tabs">
                      {s.actions.length ? (
                        s.actions.map((a) => (
                          <button
                            className={action?.id === a.id ? "selected" : ""}
                            key={a.id}
                            onClick={() => setSelected(a.id)}
                          >
                            {a.kind === 0
                              ? `Купон ${a.period}`
                              : a.kind === 1
                                ? "Погашение"
                                : "Частичное"}
                            <span
                              className={
                                a.status === 4 ? "tab-dot done" : "tab-dot"
                              }
                            />
                          </button>
                        ))
                      ) : (
                        <span>Пока нет запланированных событий</span>
                      )}
                    </div>
                    {action ? (
                      <>
                        <div className="action-summary">
                          <span className="action-icon">
                            {action.kind === 0 ? (
                              <ArrowDownLeft />
                            ) : (
                              <AudioLines />
                            )}
                          </span>
                          <div>
                            <h3>
                              {labels[action.kind]}
                              {action.kind === 0 ? ` №${action.period}` : ""}
                            </h3>
                            <small>
                              CA-{String(action.id).padStart(3, "0")}{" "}
                              <span>·</span> {symbol}
                              {action.kind === 2
                                ? ` · ${action.bps / 100}% токенов`
                                : ""}
                            </small>
                          </div>
                          <span
                            className={`badge ${action.status === 4 ? "green" : "amber"}`}
                          >
                            {statuses[action.status]}
                          </span>
                        </div>
                        <div className="action-facts">
                          <div>
                            <small>Дата фиксации прав</small>
                            <b>{dates(action.recordAt)}</b>
                          </div>
                          <div>
                            <small>Объём расчёта</small>
                            <b>
                              {action.rows.length
                                ? money(sum(action))
                                : "После фиксации"}
                            </b>
                          </div>
                          <div>
                            <small>Получатели</small>
                            <b>
                              {action.rows.length || "—"} <span>держателя</span>
                            </b>
                          </div>
                        </div>
                        <div className="steps">
                          {[
                            "Фиксация прав",
                            "Расчёт прав",
                            "Инициация",
                            "Подтверждение",
                          ].map((n, i) => (
                            <div
                              key={n}
                              className={
                                action.status > i ||
                                (i === 1 && action.status >= 1)
                                  ? "complete"
                                  : ""
                              }
                            >
                              <span>
                                {action.status > i ||
                                (i === 1 && action.status >= 1) ? (
                                  <Check size={13} />
                                ) : (
                                  i + 1
                                )}
                              </span>
                              <small>{n}</small>
                            </div>
                          ))}
                        </div>
                        <div className="action-bottom">
                          <span>
                            <ShieldCheck size={16} />
                            {action.snapshotSlot !== "0"
                              ? `Снимок сохранён · слот ${action.snapshotSlot}`
                              : now < action.recordAt
                                ? `До фиксации: ${action.recordAt - now} сек.`
                                : "Record date наступила. Переводы заблокированы."}
                          </span>
                          {action.status === 0 ? (
                            <button
                              className="button primary"
                              disabled={busy || now < action.recordAt}
                              onClick={() => act({ operation: "snapshot" })}
                            >
                              Зафиксировать права <ArrowRight size={15} />
                            </button>
                          ) : action.status === 1 ? (
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() => act({ operation: "initiate" })}
                            >
                              Инициировать расчёт <ArrowRight size={15} />
                            </button>
                          ) : action.status < 4 ? (
                            <span className="badge amber">
                              Ожидаем подтверждения выплат
                            </span>
                          ) : (
                            <span className="badge green">
                              <CheckCheck size={14} />
                              Исполнено
                            </span>
                          )}
                        </div>
                        {action.status < 3 &&
                          action.rows.every((r) => !r.settled) && (
                            <div className="action-cancel">
                              {cancelling ? (
                                <>
                                  <span>
                                    Отменить действие? Record date снимется,
                                    переводы разблокируются.
                                  </span>
                                  <button
                                    className="button secondary"
                                    disabled={busy}
                                    onClick={() => setCancelling(false)}
                                  >
                                    Нет
                                  </button>
                                  <button
                                    className="button danger"
                                    disabled={busy}
                                    onClick={async () => {
                                      await act({ operation: "cancel" });
                                      setCancelling(false);
                                    }}
                                  >
                                    Да, отменить
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() => setCancelling(true)}
                                >
                                  <X size={14} />
                                  Отменить действие
                                </button>
                              )}
                            </div>
                          )}
                        {action.rows.length > 0 && (
                          <div className="entitlements">
                            <table>
                              <thead>
                                <tr>
                                  <th>Получатель</th>
                                  <th>Токены на дату</th>
                                  <th>Начислено</th>
                                  <th>Расчёт</th>
                                </tr>
                              </thead>
                              <tbody>
                                {action.rows.map((r) => (
                                  <tr key={r.holder}>
                                    <td>{s.config.names[r.holder]}</td>
                                    <td>
                                      {r.units}
                                      {r.retireUnits !== "0" && (
                                        <small className="retire">
                                          Погашение: {r.retireUnits}
                                        </small>
                                      )}
                                    </td>
                                    <td className="amount">
                                      {money(r.amount)}
                                    </td>
                                    <td>
                                      {r.settled ? (
                                        <span className="settled">
                                          <Check size={14} /> Подтверждён
                                        </span>
                                      ) : action.status >= 2 ? (
                                        <button
                                          className="confirm-button"
                                          disabled={busy}
                                          onClick={() =>
                                            act({
                                              operation: "confirm",
                                              holder: r.holder,
                                            })
                                          }
                                        >
                                          {s.tokens?.enabled
                                            ? "Выплатить TEST USD"
                                            : "Подтвердить демо"}
                                        </button>
                                      ) : (
                                        <span className="muted">
                                          Не инициирован
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="empty-action">
                        <div className="empty-visual">
                          <AudioLines size={30} />
                          <span>
                            <Plus size={12} />
                          </span>
                        </div>
                        <h3>Первое действие — начало потока</h3>
                        <p>
                          Зафиксируйте держателей и запустите купонную выплату.
                          <br />
                          Все расчёты проверит программа Solana.
                        </p>
                        <button
                          className="button primary"
                          onClick={() => openAction()}
                        >
                          Создать купонную выплату <ArrowRight size={15} />
                        </button>
                        <div className="empty-flow">
                          <span>Держатели</span>
                          <ArrowRight size={12} />
                          <span>Права</span>
                          <ArrowRight size={12} />
                          <span>Расчёт</span>
                          <ArrowRight size={12} />
                          <span>Запись в сети</span>
                        </div>
                      </div>
                    )}
                  </section>
                  <aside className="right-column">
                    <section className="panel lifecycle">
                      <div className="panel-head">
                        <h3>Жизненный цикл</h3>
                        <span className="tiny-label">{symbol}</span>
                      </div>
                      <div className="timeline">
                        <div className="timeline-item checked">
                          <span>
                            <Check size={12} />
                          </span>
                          <div>
                            <b>Выпуск инструмента</b>
                            <small>
                              {String(BigInt(s.supply) + BigInt(s.retired))}{" "}
                              токенов · {s.holders.length} держателей
                            </small>
                            <em>Завершено</em>
                          </div>
                        </div>
                        {[
                          "Купонные выплаты",
                          "Частичное погашение",
                          "Погашение при наступлении срока",
                        ].map((n, i) => (
                          <div
                            className={
                              "timeline-item " +
                              ((
                                i === 0
                                  ? allCoupons
                                  : s.actions.some(
                                      (a) =>
                                        a.kind === [0, 2, 1][i] &&
                                        a.status === 4,
                                    )
                              )
                                ? "checked"
                                : "")
                            }
                            key={n}
                          >
                            <span>{i + 2}</span>
                            <div>
                              <b>{n}</b>
                              <small>
                                {i === 0
                                  ? `${s.periods} купонов · ${money((BigInt(s.face) * BigInt(s.couponBps)) / (10000n * BigInt(s.frequency)))} за токен`
                                  : i === 1
                                    ? "Дополнительное действие"
                                    : dates(s.maturity)}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="clock-note">
                        <Clock3 size={15} />
                        <span>
                          Даты наступают по времени Devnet. Включите автопилот
                          для выполнения по расписанию.
                        </span>
                      </div>
                    </section>
                    <section className="trust-card">
                      <ShieldCheck size={24} />
                      <h3>Права, которые можно проверить</h3>
                      <p>
                        Снимок, начисления и статус каждого получателя хранятся
                        в аккаунте программы.
                      </p>
                      <button onClick={() => setPage(3)}>
                        Открыть журнал <ArrowUpRight size={16} />
                      </button>
                    </section>
                  </aside>
                </div>
              )}
              {(page === 0 || page === 2) && (
                <section className="panel registry">
                  <div className="panel-head">
                    <div>
                      <h3>
                        Реестр держателей{" "}
                        <span className="count">{s.holders.length}</span>
                      </h3>
                      <p>Текущие балансы программного токена</p>
                    </div>
                    <div className="panel-tools">
                      {page === 2 && (
                        <label className="search">
                          <Search size={15} />
                          <input
                            placeholder="Поиск держателя"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                          />
                        </label>
                      )}
                      <button
                        className="button secondary"
                        disabled={
                          busy ||
                          s.holders.length < 2 ||
                          now >= s.maturity ||
                          (active && now >= current.recordAt)
                        }
                        title={transferReason || "Перевод между держателями"}
                        onClick={() => setModal("transfer")}
                      >
                        <ArrowLeftRight size={15} />
                        Перевести токены
                      </button>
                      {page === 0 && (
                        <button
                          className="text-button"
                          onClick={() => setPage(2)}
                        >
                          Открыть реестр <ArrowRight size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                  {transferReason && (
                    <p className="transfer-reason">{transferReason}</p>
                  )}
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Держатель</th>
                          <th>Адрес в Solana</th>
                          <th>Количество</th>
                          <th>Номинальная стоимость</th>
                          <th>Доля выпуска</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.holders
                          .filter((h, i) =>
                            (s.config.names[i] + h.wallet)
                              .toLowerCase()
                              .includes(query.toLowerCase()),
                          )
                          .map((h) => {
                            const portion = Number(s.supply)
                              ? (Number(h.units) / Number(s.supply)) * 100
                              : 0;
                            return (
                              <tr key={h.wallet}>
                                <td>
                                  <div className="holder">
                                    <span
                                      className={`holder-avatar color-${h.index}`}
                                    >
                                      {s.config.names[h.index]
                                        .split(" ")
                                        .map((v) => v[0])
                                        .join("")}
                                    </span>
                                    <div>
                                      <b>{s.config.names[h.index]}</b>
                                      <small>
                                        {h.index < 2
                                          ? "Институциональный"
                                          : "Частный инвестор"}
                                      </small>
                                    </div>
                                  </div>
                                </td>
                                <td>
                                  <button
                                    className="address"
                                    title={h.wallet}
                                    onClick={() => {
                                      void navigator.clipboard.writeText(
                                        h.wallet,
                                      );
                                      setToast("Адрес скопирован");
                                    }}
                                  >
                                    {short(h.wallet)}
                                    <Copy size={12} />
                                  </button>
                                </td>
                                <td className="amount">
                                  {Number(h.units).toLocaleString()}{" "}
                                  <span className="muted">{symbol}</span>
                                </td>
                                <td className="amount">
                                  {money(BigInt(h.units) * BigInt(s.face))}
                                </td>
                                <td>
                                  <div className="portion">
                                    <span>{portion.toFixed(1)}%</span>
                                    <i>
                                      <b style={{ width: `${portion}%` }} />
                                    </i>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                  <div className="table-footer">
                    <span>
                      <Fingerprint size={14} />
                      Источник: аккаунт программы Solana
                    </span>
                    <span>
                      Погашено токенов: <b>{s.retired}</b>
                    </span>
                  </div>
                </section>
              )}
              {page === 3 && (
                <section className="panel audit">
                  <div className="panel-head">
                    <div>
                      <h3>
                        Записи исполнения{" "}
                        <span className="count">{s.journal.length}</span>
                      </h3>
                      <p>
                        Нажмите на транзакцию, чтобы проверить результат
                        непосредственно через RPC.
                      </p>
                    </div>
                    <a
                      className="button secondary"
                      href={`/api/export?issue=${encodeURIComponent(s?.config.state ?? issueId)}`}
                      download
                    >
                      <Download size={16} />
                      Экспорт JSON
                    </a>
                  </div>
                  <div className="account-info">
                    <span>Аккаунт инструмента</span>
                    <code>{s.config.state}</code>
                    <span>Программа</span>
                    <code>{s.config.programId}</code>
                  </div>
                  {s.journal.map((j, i) => (
                    <button
                      className="journal-row"
                      key={j.signature}
                      onClick={() => inspect(j.signature)}
                    >
                      <span className="journal-check">
                        <Check size={15} />
                      </span>
                      <div>
                        <b>{journalLabels[j.type] ?? j.label ?? j.type}</b>
                        <small>
                          {new Date(j.time).toLocaleString("ru-RU")}
                        </small>
                      </div>
                      <code>{short(j.signature)}</code>
                      <span className="badge green">Подтверждено</span>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </section>
              )}
              <footer>
                <span>
                  <span className="footer-dot" />
                  Solana Devnet · данные обновляются с задержкой до 8 сек.
                </span>
                <div>
                  <button disabled={busy} onClick={() => newDemo()}>
                    <RotateCcw size={13} />
                    Новый демо-выпуск
                  </button>
                  <span>KASE × Superteam Kazakhstan</span>
                </div>
              </footer>
            </>
          ) : (
            !error &&
            page !== 5 && (
              <div className="loading">
                <LoaderCircle className="spin" />
                Подключаемся к Solana…
              </div>
            )
          )}
        </main>
      </div>
      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "action"
                ? "Новое корпоративное действие"
                : modal === "transfer"
                  ? "Перевод токенов"
                  : "О прототипе"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Закрыть"
              disabled={busy}
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "action" && s ? (
              <>
                <div className="modal-symbol">
                  <AudioLines />
                </div>
                <h2>Новое корпоративное действие</h2>
                <p>
                  {symbol} · {issueName}
                </p>
                <label>
                  Тип действия
                  <CustomSelect
                    label="Тип действия"
                    value={kind}
                    onChange={setKind}
                    options={labels.map((label, value) => ({ value, label }))}
                  />
                </label>
                {kind === 0 && (
                  <label>
                    Купонный период
                    <CustomSelect
                      label="Купонный период"
                      value={period}
                      onChange={setPeriod}
                      options={Array.from({ length: s.periods }, (_, i) => {
                        const value = i + 1;
                        const paid =
                          (BigInt(s.couponMask) & (1n << BigInt(value))) !== 0n;
                        return {
                          value,
                          label: `Период ${value}${paid ? " — выплачен" : ""}`,
                          disabled: paid,
                        };
                      })}
                    />
                  </label>
                )}
                {kind === 2 && (
                  <label>
                    Доля погашаемых токенов
                    <CustomSelect
                      label="Доля погашаемых токенов"
                      value={bps}
                      onChange={setBps}
                      options={[1000, 2000, 2500, 5000].map((value) => ({
                        value,
                        label: `${value / 100}%`,
                      }))}
                    />
                  </label>
                )}
                <div className="calculation">
                  <div>
                    <span>Предварительный объём</span>
                    <strong>{money(expected)}</strong>
                  </div>
                  <small>
                    {kind === 0
                      ? `Токены × ${money(s.face)} × ${s.couponBps / 100}% ÷ ${s.frequency}`
                      : kind === 2
                        ? `⌊Токены держателя × доля⌋ × ${money(s.face)}`
                        : `Все оставшиеся токены × ${money(s.face)}`}
                  </small>
                  <hr />
                  <div>
                    <span>Record date (время сети)</span>
                    <b>{dates(recordAt)}</b>
                  </div>
                  <small>
                    Автоматически: ближайшая допустимая дата. Балансы
                    фиксируются после её наступления.
                  </small>
                </div>
                <ActionPreview s={s} kind={kind} bps={bps} />
                {active && (
                  <div className="modal-warning">
                    Выполняется другое действие. Завершите его перед
                    планированием следующего.
                  </div>
                )}
                {kind === 1 && !allCoupons && (
                  <div className="modal-warning">
                    Сначала завершите все {s.periods} купонных периодов, включая
                    финальный.
                  </div>
                )}
                {kind === 2 && !retiresWholeBond && (
                  <div className="modal-warning">
                    При доле {bps / 100}% ни у одного держателя не погашается
                    целая облигация. Выберите долю больше.
                  </div>
                )}
                {kind === 2 && now >= s.maturity && (
                  <div className="modal-warning">
                    Срок выпуска наступил. Для этого сценария создайте новый
                    демо-выпуск.
                  </div>
                )}
                <p className="fine-print">
                  Расчёт выполняется токенами TEST USD из escrow в Solana
                  Devnet.
                </p>
                <button
                  className="button primary full"
                  disabled={
                    busy ||
                    active ||
                    s.supply === "0" ||
                    (kind === 0 && allCoupons) ||
                    (kind === 1 && !allCoupons) ||
                    (kind === 2 &&
                      (recordAt >= s.maturity || !retiresWholeBond))
                  }
                  onClick={() =>
                    act({
                      operation: "schedule",
                      kind,
                      period: kind === 0 ? period : 0,
                      bps: kind === 0 ? 0 : kind === 1 ? 10000 : bps,
                      recordAt,
                    })
                  }
                >
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Plus size={17} />
                  )}
                  Запланировать в Solana
                </button>
              </>
            ) : modal === "transfer" && s ? (
              <>
                <h2>Перевод токенов</h2>
                <p>Транзакцию подписывает тестовый кошелёк держателя.</p>
                <label>
                  Отправитель
                  <CustomSelect
                    label="Отправитель"
                    value={transfer.from}
                    onChange={(from) => setTransfer({ ...transfer, from })}
                    options={s.holders.map((h) => ({
                      value: h.index,
                      label: `${s.config.names[h.index]} · ${h.units} ${symbol}`,
                    }))}
                  />
                </label>
                <label>
                  Получатель
                  <CustomSelect
                    label="Получатель"
                    value={transfer.to}
                    onChange={(to) => setTransfer({ ...transfer, to })}
                    options={s.holders.map((h) => ({
                      value: h.index,
                      label: s.config.names[h.index],
                    }))}
                  />
                </label>
                <label>
                  Количество
                  <input
                    type="number"
                    min="1"
                    max={s.holders[transfer.from].units}
                    value={transfer.units}
                    onChange={(e) =>
                      setTransfer({
                        ...transfer,
                        units: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <button
                  className="button primary full"
                  disabled={
                    busy ||
                    transfer.from === transfer.to ||
                    !Number.isInteger(transfer.units) ||
                    transfer.units < 1
                  }
                  onClick={() => act({ operation: "transfer", ...transfer })}
                >
                  Подписать и перевести <ArrowRight size={15} />
                </button>
              </>
            ) : (
              <>
                <div className="modal-symbol">
                  <Blocks />
                </div>
                <h2>Рабочий прототип. Ясные границы.</h2>
                <p>Независимая хакатонная разработка для трека KASE.</p>
                <div className="about-section">
                  <h3>
                    <Check size={17} />
                    Реализовано в Solana
                  </h3>
                  <p>
                    Облигации Token-2022, реестр и переводы; блокировка по
                    record date; снимок держателей; целочисленные начисления;
                    купоны, частичное и полное погашение; индивидуальные статусы
                    и защита от повторного исполнения.
                  </p>
                </div>
                <div className="about-section">
                  <h3>
                    <Flask />
                    Демонстрационные интеграции
                  </h3>
                  <p>
                    TEST USD — тестовый SPL-токен без денежного обеспечения.
                    Выплата действительно переводит токены из escrow. При
                    погашении перевод и сжигание облигаций атомарны. Ключи
                    демо-инвесторов хранит сервер; подключённый кошелёк
                    подписывает получение самостоятельно. Все операции
                    выполняются в публичной тестовой сети Devnet.
                  </p>
                </div>
                <div className="about-section">
                  <h3>
                    <CircleHelp size={17} />
                    Ограничения
                  </h3>
                  <p>
                    До 16 держателей и 16 действий. Счета облигаций заморожены;
                    переводы доступны через программу с подписью держателя. Нет
                    интеграции с KASE, банком или KYC. Частичное погашение
                    округляется вниз до целого токена; купон — до микро-USD.
                  </p>
                </div>
                <a
                  className="button secondary full"
                  href={`/api/export?issue=${encodeURIComponent(s?.config.state ?? issueId)}`}
                  download
                >
                  <Download size={16} />
                  Скачать доказательства исполнения
                </a>
              </>
            )}
          </section>
        </div>
      )}
      {tx && (
        <div className="modal-backdrop" onClick={() => setTx(null)}>
          <section
            className="modal tx-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Транзакция Solana"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Закрыть"
              onClick={() => setTx(null)}
            >
              <X size={20} />
            </button>
            <h2>Транзакция Solana</h2>
            <span className="badge green">
              {tx.meta?.err ? "Ошибка исполнения" : "Успешно исполнена"}
            </span>
            <p>Solana Devnet · слот {tx.slot}</p>
            {s?.config.network === "devnet" && (
              <a
                className="button secondary"
                href={`https://explorer.solana.com/tx/${tx.signature}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
              >
                Открыть в Solana Explorer <ArrowUpRight size={15} />
              </a>
            )}
            <label>
              Подпись<code className="signature">{tx.signature}</code>
            </label>
            <h3>Логи программы</h3>
            <pre>{tx.meta?.logMessages?.join("\n") ?? "Логи недоступны"}</pre>
          </section>
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          <Radio size={17} />
          {toast}
          <button aria-label="Скрыть" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="pending">
          <LoaderCircle size={15} className="spin" />
          Подтверждаем транзакцию…
        </div>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  foot,
  icon,
}: {
  label: string;
  value: string;
  foot: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="metric">
      <div>
        <span>{label}</span>
        {icon}
      </div>
      <strong>{value}</strong>
      <small>{foot}</small>
    </article>
  );
}
function Flask() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <path d="M9 3h6M10 3v6L4 19q-1 2 2 2h12q3 0 2-2L14 9V3M7 15h10" />
    </svg>
  );
}
