import type { State } from "./main";
import {
  CalendarDays,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Download,
  RefreshCw,
  Undo2,
} from "lucide-react";
import { post } from "./Investor";
import { useState } from "react";
export const money = (n: bigint | string) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(
    Number(n) / 1e6,
  ) + " TEST USD";
const date = (n: number) => new Date(n * 1000).toLocaleString("ru-RU");
export function entitlement(
  s: State,
  units: string,
  kind: number,
  bps: number,
) {
  const q = BigInt(units),
    face = BigInt(s.face);
  return kind === 0
    ? (q * face * BigInt(s.couponBps)) / (10000n * BigInt(s.frequency))
    : (kind === 1 ? q : (q * BigInt(bps)) / 10000n) * face;
}
export function ActionPreview({
  s,
  kind,
  bps,
}: {
  s: State;
  kind: number;
  bps: number;
}) {
  const total = s.holders.reduce(
      (n, h) => n + entitlement(s, h.units, kind, bps),
      0n,
    ),
    escrow = BigInt(s.balances?.escrow ?? 0),
    deficit = total > escrow ? total - escrow : 0n;
  return (
    <section className="action-preview">
      <h3>Предварительное распределение</h3>
      <p>
        По текущему реестру. Окончательные права фиксируются на record date.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Держатель</th>
              <th>TEST USD</th>
              {kind !== 0 && <th>К погашению</th>}
            </tr>
          </thead>
          <tbody>
            {s.holders
              .filter((h) => BigInt(h.units) > 0n)
              .map((h) => (
                <tr key={h.wallet}>
                  <td>{s.config.names[h.index]}</td>
                  <td>
                    {money(entitlement(s, h.units, kind, bps)).replace(
                      " TEST USD",
                      "",
                    )}
                  </td>
                  {kind !== 0 && (
                    <td>
                      {String(
                        kind === 1
                          ? BigInt(h.units)
                          : (BigInt(h.units) * BigInt(bps)) / 10000n,
                      )}
                    </td>
                  )}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div className={`funding-check ${deficit ? "shortfall" : ""}`}>
        {deficit ? <AlertTriangle size={17} /> : <CheckCircle2 size={17} />}
        <span>
          {deficit
            ? `Для исполнения не хватает ${money(deficit)}`
            : `Escrow покрывает выплату: ${money(escrow)}`}
        </span>
      </div>
    </section>
  );
}
export function Lifecycle({
  s,
  onAction,
  refresh,
  notify,
}: {
  s: State;
  onAction: (kind: number) => void;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const active = s.actions.at(-1),
    running = active && active.status < 4;
  const redemption = s.actions.find((a) => a.kind === 1);
  const coupon = s.holders.reduce(
    (n, h) => n + entitlement(s, h.units, 0, 0),
    0n,
  );
  const periods = Array.from({ length: s.periods }, (_, i) => i + 1);
  const unpaid = periods.filter(
    (p) => (BigInt(s.couponMask) & (1n << BigInt(p))) === 0n,
  );
  const partiallyPaid =
    running && active.kind === 0
      ? active.rows
          .filter((r) => r.settled)
          .reduce((n, r) => n + BigInt(r.amount), 0n)
      : 0n;
  const forecast =
    BigInt(s.supply) * BigInt(s.face) +
    coupon * BigInt(unpaid.length) -
    partiallyPaid;
  const escrow = BigInt(s.balances?.escrow ?? 0),
    missing = forecast > escrow ? forecast - escrow : 0n;
  const registry = s.holders.reduce((n, h) => n + BigInt(h.units), 0n);
  const accountsMatch =
    !!s.balances &&
    s.balances.holders.length === s.holders.length &&
    s.holders.every((h, i) => h.units === s.balances!.holders[i].bonds);
  const consistent =
    registry === BigInt(s.supply) &&
    s.balances?.supply === s.supply &&
    accountsMatch;
  const closed =
    s.supply === "0" &&
    unpaid.length === 0 &&
    s.actions.every((a) => a.status === 4);
  async function release() {
    setBusy(true);
    try {
      await post("action", { operation: "withdraw" }, s.config.state);
      await refresh();
      notify("Остаток escrow возвращён эмитенту");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function retry() {
    setBusy(true);
    try {
      await post("automation", { enabled: true }, s.config.state);
      await refresh();
      notify("Автопилот продолжит с первого незавершённого шага");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="lifecycle-workspace">
      <div className="workspace-stat-row">
        <div>
          <span>Прогноз оставшихся обязательств</span>
          <strong>{money(forecast)}</strong>
        </div>
        <div>
          <span>В escrow</span>
          <strong>{money(escrow)}</strong>
        </div>
        <div>
          <span>
            {missing ? "Необходимо пополнить" : "Запас после исполнения"}
          </span>
          <strong>{money(missing || escrow - forecast)}</strong>
        </div>
      </div>
      <p className="forecast-note">
        Прогноз по текущему объёму облигаций, без будущих переводов и частичных
        погашений. Все суммы — тестовые.
      </p>
      <div className="content-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>
              <CalendarDays size={20} />
              Календарь обязательств
            </h3>
          </div>
          {periods.map((p) => {
            const due =
                s.issuedAt +
                Math.floor(((s.maturity - s.issuedAt) * p) / s.periods),
              done = !unpaid.includes(p),
              action = s.actions.find((a) => a.kind === 0 && a.period === p);
            return (
              <div className="calendar-row" key={p}>
                <span className={`calendar-mark ${done ? "done" : ""}`}>
                  {done ? <CheckCircle2 size={18} /> : p}
                </span>
                <div>
                  <b>Купон №{p}</b>
                  <small>{date(due)}</small>
                </div>
                <span>
                  {action?.rows.length
                    ? money(
                        action.rows.reduce((n, r) => n + BigInt(r.amount), 0n),
                      )
                    : money(coupon)}
                </span>
                <span className={`badge ${done ? "green" : "amber"}`}>
                  {done
                    ? "Выплачен"
                    : action
                      ? "В работе"
                      : due <= s.chainTime
                        ? "Наступил срок"
                        : "Запланирован"}
                </span>
              </div>
            );
          })}
          {s.actions
            .filter((a) => a.kind === 2)
            .map((a) => (
              <div className="calendar-row" key={`partial-${a.id}`}>
                <span
                  className={`calendar-mark ${a.status === 4 ? "done" : ""}`}
                >
                  <CheckCircle2 size={18} />
                </span>
                <div>
                  <b>Частичное погашение · {a.bps / 100}%</b>
                  <small>{date(a.recordAt)}</small>
                </div>
                <span>
                  {a.rows.length
                    ? money(a.rows.reduce((n, r) => n + BigInt(r.amount), 0n))
                    : "После фиксации"}
                </span>
                <span className={`badge ${a.status === 4 ? "green" : "amber"}`}>
                  {a.status === 4 ? "Исполнено" : "В работе"}
                </span>
              </div>
            ))}
          <div className="calendar-row">
            <span className={`calendar-mark ${closed ? "done" : ""}`}>
              <CheckCircle2 size={18} />
            </span>
            <div>
              <b>Возврат основного долга</b>
              <small>{date(s.maturity)}</small>
            </div>
            <span>
              {money(
                redemption?.rows.length
                  ? redemption.rows.reduce((n, r) => n + BigInt(r.amount), 0n)
                  : BigInt(s.supply) * BigInt(s.face),
              )}
            </span>
            <span className={`badge ${closed ? "green" : "amber"}`}>
              {closed
                ? "Погашен"
                : unpaid.length
                  ? "После купонов"
                  : "Ожидает исполнения"}
            </span>
          </div>
        </section>
        <section className="panel operation-panel">
          <h3>Контроль исполнения</h3>
          <p>
            {s.automation.enabled
              ? "Автопилот включён для этого выпуска"
              : "Ручное управление выпуском"}
          </p>
          <dl>
            <dt>Текущий шаг</dt>
            <dd>
              {running
                ? [
                    "Ожидание record date",
                    "Расчёт и инициация",
                    "Выплаты держателям",
                    "Оставшиеся выплаты",
                  ][active.status]
                : closed
                  ? "Все обязательства исполнены"
                  : "Ожидание следующего события"}
            </dd>
            <dt>Последний автоматический шаг</dt>
            <dd>
              {s.automation.lastRun
                ? new Date(s.automation.lastRun).toLocaleString("ru-RU")
                : "Ещё не выполнялся"}
            </dd>
          </dl>
          {s.automation.closed && !s.automation.enabled && (
            <p className="forecast-note">
              Выпуск закрыт, автопилот остановлен.
            </p>
          )}
          {s.automation.error && (
            <div className="workspace-error" role="alert">
              {s.automation.error}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void retry()}
              >
                <RefreshCw size={16} />
                Повторить незавершённый шаг
              </button>
            </div>
          )}
          {!closed && (
            <button
              className="button secondary"
              disabled={!!running}
              onClick={() => onAction(unpaid.length ? 0 : 1)}
            >
              Подготовить действие
              <ArrowRight size={16} />
            </button>
          )}
          {running && (
            <p className="disabled-reason">
              Сначала завершите текущее действие.
            </p>
          )}
        </section>
      </div>
      <section className="panel reconciliation">
        <div className="panel-head">
          <div>
            <h3>{closed ? "Закрытие выпуска" : "Сверка реестра и токенов"}</h3>
            <p>Проверка состояния программы и SPL-счетов в Devnet.</p>
          </div>
          <a
            className="button secondary"
            href={`/api/export?issue=${encodeURIComponent(s.config.state)}`}
            download
          >
            <Download size={16} />
            Отчёт по выпуску
          </a>
        </div>
        <div className="reconciliation-checks">
          <span className={consistent ? "good" : "bad"}>
            {consistent ? (
              <CheckCircle2 size={19} />
            ) : (
              <AlertTriangle size={19} />
            )}
            Реестр, mint supply и счета держателей{" "}
            {consistent ? "совпадают" : "требуют проверки"}
          </span>
          <span>
            {unpaid.length === 0
              ? "Все купонные периоды закрыты"
              : `Осталось купонных периодов: ${unpaid.length}`}
          </span>
          <span>
            {closed
              ? "Все облигации погашены"
              : `Осталось облигаций: ${s.supply}`}
          </span>
        </div>
        {closed && escrow > 0n && (
          <div className="escrow-release">
            <span>
              Остаток escrow после всех выплат: <b>{money(escrow)}</b>.
              Программа переводит его только эмитенту и только после полного
              погашения.
            </span>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => void release()}
            >
              <Undo2 size={16} />
              Вернуть остаток эмитенту
            </button>
          </div>
        )}
        {s.config.metadata?.termsHash && (
          <p className="terms-hash">
            Отпечаток утверждённых условий (off-chain):{" "}
            <code>{s.config.metadata.termsHash}</code>
          </p>
        )}
      </section>
    </div>
  );
}
