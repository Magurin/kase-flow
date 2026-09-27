import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  RefreshCw,
  Undo2,
} from "lucide-react";
import type { Ctx } from "../ctx";
import {
  actionTitle,
  couponPaid,
  dueOf,
  entitlement,
  isClosed,
  symbolOf,
  unpaidPeriods,
} from "../domain";
import { dateTime, money, units } from "../format";
import { Kpi, PanelHead } from "../ui";
import { post } from "../api";

export function Control(c: Ctx) {
  const { s, now } = c;
  const [busy, setBusy] = useState(false);
  const active = s.actions.at(-1);
  const running = !!active && active.status < 4;
  const coupon = s.holders.reduce(
    (n, h) => n + entitlement(s, h.units, 0, 0),
    0n,
  );
  const unpaid = unpaidPeriods(s);
  const partlyPaid =
    running && active.kind === 0
      ? active.rows
          .filter((r) => r.settled)
          .reduce((n, r) => n + BigInt(r.amount), 0n)
      : 0n;
  const forecast =
    BigInt(s.supply) * BigInt(s.face) +
    coupon * BigInt(unpaid.length) -
    partlyPaid;
  const escrow = BigInt(s.balances?.escrow ?? 0);
  const missing = forecast > escrow ? forecast - escrow : 0n;
  const registry = s.holders.reduce((n, h) => n + BigInt(h.units), 0n);
  const accountsMatch =
    !!s.balances &&
    s.balances.holders.length === s.holders.length &&
    s.holders.every((h, i) => h.units === s.balances!.holders[i].bonds);
  const checks = [
    [
      "Реестр программы равен объёму в обращении",
      registry === BigInt(s.supply),
    ],
    ["Mint supply равен объёму в обращении", s.balances?.supply === s.supply],
    ["Балансы счетов Token-2022 совпадают с реестром", accountsMatch],
    ["Escrow покрывает оставшиеся обязательства", missing === 0n],
  ] as const;
  const closed = isClosed(s);
  async function call(path: string, body: object, done: string) {
    setBusy(true);
    try {
      await post(path, body, s.config.state);
      await c.refresh();
      c.notify(done);
    } catch (e) {
      c.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const partials = s.actions.filter((a) => a.kind === 2);
  const redemption = s.actions.find((a) => a.kind === 1);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            <b>{symbolOf(s)}</b> · контроль исполнения
          </div>
          <h1>Календарь и контроль</h1>
          <p className="page-sub">
            График обязательств, покрытие escrow и сверка реестра с токенами.
          </p>
        </div>
        <div className="page-actions">
          <a
            className="btn btn-secondary"
            href={`/api/export?issue=${encodeURIComponent(s.config.state)}`}
            download
          >
            <Download size={16} />
            Отчёт по выпуску
          </a>
        </div>
      </div>

      <div className="kpis">
        <Kpi
          label="Оставшиеся обязательства"
          value={money(forecast)}
          unit="TEST USD"
          note="По текущему объёму, без будущих переводов"
        />
        <Kpi label="Остаток escrow" value={money(escrow)} unit="TEST USD" />
        <Kpi
          label={missing ? "Не хватает" : "Запас после исполнения"}
          value={money(missing || escrow - forecast)}
          unit="TEST USD"
          tone={missing ? "bad" : "good"}
        />
        <Kpi
          label="Купонов осталось"
          value={`${unpaid.length} из ${s.periods}`}
        />
      </div>

      <div className="grid main-side">
        <section className="panel">
          <PanelHead
            title="График обязательств"
            sub="Плановые даты по времени сети Devnet"
          />
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Событие</th>
                  <th>Плановая дата</th>
                  <th className="num">Сумма, TEST USD</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: s.periods }, (_, i) => i + 1).map((p) => {
                  const due = dueOf(s, p),
                    paid = couponPaid(s, p),
                    action = s.actions.find(
                      (a) => a.kind === 0 && a.period === p,
                    );
                  return (
                    <tr key={p}>
                      <td>Купон №{p}</td>
                      <td className="nowrap">{dateTime(due)}</td>
                      <td className="num">
                        {money(
                          action?.rows.length
                            ? action.rows.reduce(
                                (n, r) => n + BigInt(r.amount),
                                0n,
                              )
                            : coupon,
                        )}
                      </td>
                      <td>
                        <span
                          className={`badge ${paid ? "ok" : action ? "info" : due <= now ? "warn" : ""}`}
                        >
                          {paid
                            ? "Выплачен"
                            : action
                              ? "В работе"
                              : due <= now
                                ? "Срок наступил"
                                : "Запланирован"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {partials.map((a) => (
                  <tr key={a.id}>
                    <td>{actionTitle(a)}</td>
                    <td className="nowrap">{dateTime(a.recordAt)}</td>
                    <td className="num">
                      {a.rows.length
                        ? money(
                            a.rows.reduce((n, r) => n + BigInt(r.amount), 0n),
                          )
                        : "после фиксации"}
                    </td>
                    <td>
                      <span
                        className={`badge ${a.status === 4 ? "ok" : "info"}`}
                      >
                        {a.status === 4 ? "Исполнено" : "В работе"}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td>Погашение номинала</td>
                  <td className="nowrap">{dateTime(s.maturity)}</td>
                  <td className="num">
                    {money(
                      redemption?.rows.length
                        ? redemption.rows.reduce(
                            (n, r) => n + BigInt(r.amount),
                            0n,
                          )
                        : BigInt(s.supply) * BigInt(s.face),
                    )}
                  </td>
                  <td>
                    <span
                      className={`badge ${closed ? "ok" : unpaid.length ? "" : "warn"}`}
                    >
                      {closed
                        ? "Погашен"
                        : unpaid.length
                          ? "После купонов"
                          : "Ожидает исполнения"}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div className="stack">
          <section className="panel">
            <PanelHead title="Исполнение">
              <span className={`badge ${s.automation.enabled ? "ok" : ""}`}>
                {c.readOnly
                  ? "Локальный режим"
                  : s.automation.enabled
                    ? "Автопилот"
                    : "Вручную"}
              </span>
            </PanelHead>
            <div className="panel-body stack" style={{ gap: 12 }}>
              <div className="rows">
                <div>
                  <span>Текущий шаг</span>
                  <b>
                    {running
                      ? [
                          "Ожидание даты фиксации",
                          "Инициация расчёта",
                          "Выплаты держателям",
                          "Оставшиеся выплаты",
                        ][active.status]
                      : closed
                        ? "Обязательства исполнены"
                        : "Ожидание следующего события"}
                  </b>
                </div>
                <div>
                  <span>Последний шаг автопилота</span>
                  <b>
                    {c.readOnly
                      ? "Нет доступа к локальному расписанию"
                      : s.automation.lastRun
                        ? new Date(s.automation.lastRun).toLocaleString("ru-RU")
                        : "не выполнялся"}
                  </b>
                </div>
              </div>
              {s.automation.closed && !s.automation.enabled && (
                <p className="hint">Выпуск закрыт, автопилот остановлен.</p>
              )}
              {s.automation.error && (
                <div className="notice bad">
                  <AlertTriangle size={16} />
                  <span className="grow">{s.automation.error}</span>
                </div>
              )}
              {s.automation.error && (
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={c.readOnly || busy}
                  onClick={() =>
                    call(
                      "automation",
                      { enabled: true },
                      "Автопилот продолжит с первого незавершённого шага",
                    )
                  }
                >
                  <RefreshCw size={14} /> Повторить шаг
                </button>
              )}
              {!closed && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={c.readOnly || running || c.busy}
                  onClick={() => c.openAction(unpaid.length ? 0 : 1)}
                >
                  Подготовить следующее действие
                </button>
              )}
            </div>
          </section>
          <section className="panel">
            <PanelHead
              title={closed ? "Закрытие выпуска" : "Сверка"}
              sub="Программа и счета токенов в Devnet"
            />
            <div className="panel-body rows">
              {checks.map(([label, ok]) => (
                <div key={label}>
                  <span>{label}</span>
                  <b className={ok ? "up" : "down"}>
                    {ok ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <AlertTriangle size={16} />
                    )}
                  </b>
                </div>
              ))}
            </div>
            {closed && escrow > 0n && (
              <div className="panel-foot">
                <span>
                  Остаток {money(escrow)} TEST USD. Программа отдаёт его только
                  эмитенту и только после полного погашения.
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={c.readOnly || busy}
                  onClick={() =>
                    call(
                      "action",
                      { operation: "withdraw" },
                      "Остаток escrow возвращён эмитенту",
                    )
                  }
                >
                  <Undo2 size={14} /> Вернуть эмитенту
                </button>
              </div>
            )}
          </section>
          {s.config.metadata?.termsHash && (
            <section className="panel">
              <PanelHead
                title="Утверждённые условия"
                sub="Отпечаток SHA-256, хранится вне сети"
              />
              <div className="panel-body">
                <code style={{ wordBreak: "break-all" }}>
                  {s.config.metadata.termsHash}
                </code>
              </div>
            </section>
          )}
        </div>
      </div>
      <p className="hint">
        Размещено {units(BigInt(s.supply) + BigInt(s.retired))} облигаций,
        погашено {units(s.retired)}.
      </p>
    </div>
  );
}
