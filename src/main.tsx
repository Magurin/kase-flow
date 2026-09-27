import { useCallback, useEffect, useState } from "react";
import {
  CalendarClock,
  CircleHelp,
  FileText,
  Landmark,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Radio,
  RotateCcw,
  Users,
  Wallet,
  X,
  AlertTriangle,
} from "lucide-react";
import { Buffer } from "buffer";
import "./app.css";
import type { Ctx, Page } from "./ctx";
import {
  allCouponsPaid,
  chainNow,
  isClosed,
  nameOf,
  nextEvent,
  symbolOf,
  type State,
} from "./domain";
import { money, pct, span, time, units } from "./format";
import { Mark } from "./ui";
import { ActionDialog, AboutDialog, TransferDialog, TxDialog } from "./dialogs";
import { Overview } from "./pages/Overview";
import { Actions } from "./pages/Actions";
import { Control } from "./pages/Control";
import { Registry } from "./pages/Registry";
import { Journal } from "./pages/Journal";
import { Investor } from "./pages/Investor";
import { Issues } from "./pages/Issues";
(globalThis as any).Buffer = Buffer;
export type { State } from "./domain";

const NAV: { page: Page; label: string; icon: typeof Landmark }[] = [
  { page: "overview", label: "Обзор выпуска", icon: LayoutDashboard },
  { page: "actions", label: "Корпоративные действия", icon: ListChecks },
  { page: "control", label: "Календарь и контроль", icon: CalendarClock },
  { page: "registry", label: "Реестр держателей", icon: Users },
  { page: "journal", label: "Журнал операций", icon: FileText },
];

export function App({
  issueId,
  onSelect,
  startPage = "issues",
}: {
  issueId: string;
  onSelect: (id: string) => void;
  startPage?: Page;
}) {
  const [page, setPage] = useState<Page>(startPage),
    [s, setS] = useState<State | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [dialog, setDialog] = useState<
      { type: "action"; kind: number } | { type: "transfer" } | { type: "about" } | null
    >(null),
    [tx, setTx] = useState<any>(null),
    [tick, setTick] = useState(Date.now());
  // Every request names its instrument; the server default profile is a CLI fallback.
  const scope = (): Record<string, string> => {
    const id = s?.config.state || issueId;
    return id ? { "X-Instrument-ID": id } : {};
  };
  const refresh = useCallback(async () => {
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
  }, [issueId]);
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
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  async function act(body: object) {
    setBusy(true);
    try {
      const r = await fetch("/api/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...scope() },
        body: JSON.stringify(body),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      setToast("Транзакция подтверждена в Solana");
      await refresh();
      setDialog(null);
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
        headers: { "Content-Type": "application/json", ...scope() },
        body: JSON.stringify({ wallet }),
      });
      const v = await r.json();
      if (!r.ok) throw Error(v.error);
      setToast("Создан новый тестовый выпуск");
      if (v.issueId) onSelect(v.issueId);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setBusy(false);
    }
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

  const now = s ? chainNow(s, tick) : Math.floor(tick / 1000);
  const ctx: Ctx | null = s && {
    s,
    now,
    busy,
    act,
    refresh,
    notify: setToast,
    go: setPage,
    openAction: (kind = 0) =>
      setDialog({ type: "action", kind: kind === 0 && allCouponsPaid(s) ? 1 : kind }),
    openTransfer: () => setDialog({ type: "transfer" }),
    inspect,
    newDemo,
  };
  const closed = s ? isClosed(s) : false;
  const next = s ? nextEvent(s, now) : null;
  const active = s?.actions.at(-1);
  const running = !!active && active.status < 4;

  return (
    <div className="app">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("issues");
          }}
          aria-label="KASE Flow, каталог выпусков"
        >
          <Mark />
          <span className="brand-name">
            KASE<span>Flow</span>
          </span>
        </a>
        <span className="brand-sub">
          Корпоративные действия
          <br />
          по облигациям на Solana
        </span>
        <div className="top-actions">
          <span className="net" title={error || undefined}>
            <span className={`dot ${error ? "off" : s ? "" : "idle"}`} />
            <span className="net-label">Solana Devnet</span>
            <small>
              {error ? "нет связи" : s ? `слот ${units(s.slot)}` : "подключение"}
            </small>
          </span>
          <span className="badge warn plain" title="Реальные деньги не используются">
            Тестовая среда
          </span>
          <button
            className="btn btn-sm btn-secondary"
            aria-label="О прототипе"
            onClick={() => setDialog({ type: "about" })}
          >
            <CircleHelp size={15} />
            <span className="label">О прототипе</span>
          </button>
          <button className="btn btn-sm btn-primary top-investor" onClick={() => setPage("investor")} disabled={!s}>
            <Wallet size={15} />
            <span className="label">Кабинет инвестора</span>
          </button>
        </div>
      </header>

      <div className="strip" aria-label="Данные выпуска">
        {s ? (
          <>
            <div className="strip-item lead">
              <span>{nameOf(s)}</span>
              <b>{symbolOf(s)}</b>
            </div>
            <div className="strip-item">
              <span>Номинал</span>
              <b>
                {money(s.face)}
                <small>TEST USD</small>
              </b>
            </div>
            <div className="strip-item">
              <span>Купон</span>
              <b>
                {pct(s.couponBps)}
                <small>{s.frequency} р/год</small>
              </b>
            </div>
            <div className="strip-item">
              <span>В обращении</span>
              <b>
                {units(s.supply)}
                <small>обл.</small>
              </b>
            </div>
            <div className="strip-item">
              <span>Escrow</span>
              <b>
                {money(s.balances?.escrow ?? 0)}
                <small>TEST USD</small>
              </b>
            </div>
            <div className={`strip-item ${next?.step ? "alert" : ""}`}>
              <span>{next?.title}</span>
              <b>
                {next?.at && next.at > now
                  ? `через ${span(next.at - now)}`
                  : next?.step
                    ? "требует действия"
                    : closed
                      ? "погашен"
                      : "-"}
              </b>
            </div>
            <div className="strip-item">
              <span>Время сети</span>
              <b>{time(now)}</b>
            </div>
          </>
        ) : (
          <div className="strip-item">
            <span>Выпуск</span>
            <b>{error ? "не загружен" : "загрузка…"}</b>
          </div>
        )}
      </div>

      <aside className="sidebar">
        {s && (
          <div className="side-block">
            <div className="side-label">Текущий выпуск</div>
            <button className="issue-switch" onClick={() => setPage("issues")}>
              <span className="row">
                <span className="ticker-code">{symbolOf(s)}</span>
                <span className={`badge ${closed ? "" : "ok"}`}>{closed ? "Погашен" : "В обращении"}</span>
              </span>
              <b>{nameOf(s)}</b>
              <small>{s.config.metadata?.issuer}</small>
            </button>
          </div>
        )}
        <div className="side-block">
          <div className="side-label">Выпуск</div>
          <nav className="nav" aria-label="Разделы выпуска">
            {NAV.map(({ page: p, label, icon: Icon }) => (
              <button
                key={p}
                className={page === p ? "active" : ""}
                aria-current={page === p ? "page" : undefined}
                disabled={!s}
                onClick={() => setPage(p)}
              >
                <Icon size={17} />
                {label}
                {p === "actions" && running && <span className="nav-count">1</span>}
              </button>
            ))}
          </nav>
        </div>
        <div className="side-block">
          <div className="side-label">Участники</div>
          <nav className="nav">
            <button
              className={page === "issues" ? "active" : ""}
              aria-current={page === "issues" ? "page" : undefined}
              onClick={() => setPage("issues")}
            >
              <Landmark size={17} />
              Выпуски эмитента
            </button>
            <button
              className={page === "investor" ? "active" : ""}
              aria-current={page === "investor" ? "page" : undefined}
              disabled={!s}
              onClick={() => setPage("investor")}
            >
              <Wallet size={17} />
              Кабинет инвестора
            </button>
          </nav>
        </div>
        <div className="side-foot">
          {s && (
            <span>
              Автопилот: <b>{s.automation.enabled ? "включён" : "выключен"}</b>
            </span>
          )}
          <button className="btn btn-ghost" disabled={busy} onClick={() => newDemo()}>
            <RotateCcw size={14} />
            Новый демо-выпуск
          </button>
          <span>KASE × Superteam Kazakhstan</span>
        </div>
      </aside>

      <main className="main">
        {error && (
          <div className="notice bad" style={{ marginBottom: 20 }}>
            <AlertTriangle size={16} />
            <span className="grow">
              <b>Не удалось обновить данные Solana.</b> {error}
            </span>
            <button className="btn btn-sm btn-secondary" onClick={() => void refresh()}>
              Повторить
            </button>
          </div>
        )}
        {page === "issues" ? (
          <Issues
            activeId={s?.config.state ?? issueId}
            onSelect={(id) => {
              if (id === s?.config.state) setPage("overview");
              else onSelect(id);
            }}
          />
        ) : ctx ? (
          page === "overview" ? (
            <Overview {...ctx} />
          ) : page === "actions" ? (
            <Actions {...ctx} />
          ) : page === "control" ? (
            <Control {...ctx} />
          ) : page === "registry" ? (
            <Registry {...ctx} />
          ) : page === "journal" ? (
            <Journal {...ctx} />
          ) : (
            <Investor {...ctx} />
          )
        ) : (
          !error && (
            <div className="loading">
              <LoaderCircle className="spin" size={18} />
              Читаем выпуск из Solana Devnet…
            </div>
          )
        )}
        <div className="page-foot" style={{ marginTop: 28 }}>
          <span>Данные читаются из Solana Devnet с задержкой до 8 секунд. TEST USD не имеет денежного обеспечения.</span>
          {s && <span className="mono">программа {s.config.programId.slice(0, 8)}…</span>}
        </div>
      </main>

      {dialog?.type === "action" && s && (
        <ActionDialog
          s={s}
          now={now}
          busy={busy}
          initialKind={dialog.kind}
          onClose={() => setDialog(null)}
          act={act}
        />
      )}
      {dialog?.type === "transfer" && s && (
        <TransferDialog s={s} busy={busy} onClose={() => setDialog(null)} act={act} />
      )}
      {dialog?.type === "about" && <AboutDialog s={s} onClose={() => setDialog(null)} />}
      {tx && <TxDialog tx={tx} onClose={() => setTx(null)} />}
      {toast && (
        <div className="toast" role="status">
          <Radio size={16} />
          <span>{toast}</span>
          <button aria-label="Скрыть" onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="pending">
          <LoaderCircle size={15} className="spin" />
          Подтверждаем транзакцию в Solana…
        </div>
      )}
    </div>
  );
}
