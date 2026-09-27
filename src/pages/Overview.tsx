import {
  ArrowRight,
  ArrowUpRight,
  CalendarClock,
  Plus,
  Power,
} from "lucide-react";
import { useState } from "react";
import type { Ctx } from "../ctx";
import {
  actionCode,
  actionTitle,
  holderName,
  isClosed,
  nameOf,
  nextEvent,
  actionSum,
  symbolOf,
  unpaidPeriods,
  entitlement,
} from "../domain";
import { dateTime, money, pct, short, span, tenor, units } from "../format";
import { Kpi, PanelHead, Status } from "../ui";
import { explorer, post } from "../api";

export function Overview(c: Ctx) {
  const { s, now, busy } = c;
  const [working, setWorking] = useState(false);
  const current = s.actions.at(-1);
  const active = !!current && current.status < 4;
  const closed = isClosed(s);
  const paid = s.actions
    .flatMap((a) => a.rows)
    .filter((r) => r.settled)
    .reduce((n, r) => n + BigInt(r.amount), 0n);
  const coupon = s.holders.reduce((n, h) => n + entitlement(s, h.units, 0, 0), 0n);
  const obligations =
    BigInt(s.supply) * BigInt(s.face) + coupon * BigInt(unpaidPeriods(s).length);
  const escrow = BigInt(s.balances?.escrow ?? 0);
  const coverage = obligations ? Number((escrow * 1000n) / obligations) / 10 : 100;
  const next = nextEvent(s, now);
  async function run(path: string, body: object) {
    setWorking(true);
    try {
      await post(path, body, s.config.state);
      await c.refresh();
    } catch (e) {
      c.notify((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  const holders = [...s.holders]
    .filter((h) => BigInt(h.units) > 0n)
    .sort((a, b) => Number(BigInt(b.units) - BigInt(a.units)));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            <b>{symbolOf(s)}</b> · облигации Token-2022 · Solana Devnet
          </div>
          <h1>{nameOf(s)}</h1>
          <p className="page-sub">
            Эмитент: {s.config.metadata?.issuer ?? nameOf(s)} ·{" "}
            <span className={`badge ${closed ? "" : "ok"}`}>
              {closed ? "Погашен" : "В обращении"}
            </span>
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-secondary"
            disabled={busy || closed}
            onClick={c.openTransfer}
          >
            Перевод облигаций
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || active || s.supply === "0"}
            onClick={() => c.openAction()}
          >
            <Plus size={16} />
            Новое действие
          </button>
        </div>
      </div>

      <div className="kpis">
        <Kpi
          label="Объём в обращении"
          value={money(BigInt(s.supply) * BigInt(s.face))}
          unit="TEST USD"
          note={`${units(s.supply)} обл. × ${money(s.face)}`}
        />
        <Kpi
          label="Выплачено держателям"
          value={money(paid)}
          unit="TEST USD"
          note={`Погашено облигаций: ${units(s.retired)}`}
        />
        <Kpi
          label="Остаток escrow"
          value={money(escrow)}
          unit="TEST USD"
          tone={escrow < obligations ? "bad" : undefined}
          note={
            obligations
              ? `Покрытие обязательств: ${coverage.toLocaleString("ru-RU")}%`
              : "Обязательств нет"
          }
        />
        <Kpi
          label="Держателей"
          value={holders.length}
          note={`Реестр до 16 держателей`}
        />
      </div>

      <div className="grid main-side">
        <div className="stack">
          <section className="panel">
            <PanelHead title="Параметры выпуска" sub="Записаны в аккаунт программы при размещении" />
            <dl className="kv three">
              <div>
                <dt>Номинал</dt>
                <dd>
                  {money(s.face)} <small>TEST USD</small>
                </dd>
              </div>
              <div>
                <dt>Годовая ставка купона</dt>
                <dd>{pct(s.couponBps)}</dd>
              </div>
              <div>
                <dt>Выплат в год</dt>
                <dd>{s.frequency}</dd>
              </div>
              <div>
                <dt>Купонных периодов</dt>
                <dd>
                  {s.periods - unpaidPeriods(s).length} выплачено из {s.periods}
                </dd>
              </div>
              <div>
                <dt>Номинальный срок</dt>
                <dd>{tenor(s.periods, s.frequency)}</dd>
              </div>
              <div>
                <dt>Купон на облигацию</dt>
                <dd>
                  {money((BigInt(s.face) * BigInt(s.couponBps)) / (10000n * BigInt(s.frequency)))}{" "}
                  <small>TEST USD</small>
                </dd>
              </div>
              <div>
                <dt>Размещено</dt>
                <dd>{units(BigInt(s.supply) + BigInt(s.retired))} обл.</dd>
              </div>
              <div>
                <dt>Дата размещения</dt>
                <dd>{dateTime(s.issuedAt)}</dd>
              </div>
              <div>
                <dt>Дата погашения</dt>
                <dd>{dateTime(s.maturity)}</dd>
              </div>
            </dl>
          </section>

          <section className="panel">
            <PanelHead title="Корпоративные действия" count={s.actions.length}>
              <button className="btn btn-ghost" onClick={() => c.go("actions")}>
                Все действия <ArrowRight size={15} />
              </button>
            </PanelHead>
            {s.actions.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Код</th>
                      <th>Событие</th>
                      <th>Дата фиксации</th>
                      <th className="num">Сумма, TEST USD</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...s.actions]
                      .reverse()
                      .slice(0, 5)
                      .map((a) => (
                        <tr key={a.id} className="clickable" onClick={() => c.go("actions")}>
                          <td className="mono">{actionCode(a)}</td>
                          <td>{actionTitle(a)}</td>
                          <td className="nowrap">{dateTime(a.recordAt)}</td>
                          <td className="num">{a.rows.length ? money(actionSum(a)) : "-"}</td>
                          <td>
                            <Status status={a.status} />
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="panel-body hint">
                Действий пока нет. Первым обычно планируют купон №1.
              </p>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <PanelHead title="Ближайшее событие" />
            <div className="next-event">
              <div className="what">{next.title}</div>
              <div className="when">
                {next.at
                  ? next.at > now
                    ? `через ${span(next.at - now)}`
                    : "срок наступил"
                  : next.step
                    ? "требует действия"
                    : "-"}
              </div>
              <div className="hint">
                {next.detail}
                {next.at ? ` · ${dateTime(next.at)}` : ""}
              </div>
              {next.step && (
                <button
                  className="btn btn-primary btn-block"
                  disabled={busy}
                  onClick={() =>
                    next.step === "snapshot"
                      ? c.act({ operation: "snapshot" })
                      : next.step === "initiate"
                        ? c.act({ operation: "initiate" })
                        : next.step === "pay"
                          ? c.go("actions")
                          : c.openAction(unpaidPeriods(s).length ? 0 : 1)
                  }
                >
                  {next.step === "snapshot"
                    ? "Зафиксировать реестр"
                    : next.step === "initiate"
                      ? "Инициировать расчёт"
                      : next.step === "pay"
                        ? "Перейти к выплатам"
                        : "Запланировать"}
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
          </section>

          <section className="panel">
            <PanelHead
              title="Автопилот"
              sub="Исполняет наступившие купоны и погашение по времени сети"
            >
              <span className={`badge ${s.automation.enabled ? "ok" : ""}`}>
                {s.automation.enabled ? "Включён" : "Выключен"}
              </span>
            </PanelHead>
            <div className="panel-body stack" style={{ gap: 12 }}>
              {s.automation.error && (
                <div className="notice bad">
                  <CalendarClock size={16} />
                  <span>{s.automation.error}</span>
                </div>
              )}
              <div className="rows">
                <div>
                  <span>Последний шаг</span>
                  <b>
                    {s.automation.lastRun
                      ? new Date(s.automation.lastRun).toLocaleString("ru-RU")
                      : "не выполнялся"}
                  </b>
                </div>
              </div>
              <div className="page-actions">
                <button
                  className={`btn btn-sm ${s.automation.enabled ? "btn-secondary" : "btn-primary"}`}
                  disabled={working || busy || !s.tokens?.enabled || closed}
                  onClick={() => run("automation", { enabled: !s.automation.enabled })}
                >
                  <Power size={14} />
                  {s.automation.enabled ? "Выключить" : "Включить"}
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  disabled={working || busy || closed}
                  onClick={() => run("fund", {})}
                >
                  Пополнить escrow на 100 000
                </button>
              </div>
            </div>
          </section>

          {s.tokens?.enabled && (
            <section className="panel">
              <PanelHead title="Счета в Solana" />
              <div className="panel-body rows">
                {[
                  ["Облигация, mint", s.tokens.bondMint],
                  ["TEST USD, mint", s.tokens.cashMint],
                  ["Escrow выпуска", s.tokens.vault],
                  ["Аккаунт выпуска", s.config.state],
                ].map(([label, key]) => (
                  <div key={key}>
                    <span>{label}</span>
                    <a href={explorer("address", key)} target="_blank" rel="noreferrer" className="mono">
                      {short(key)} <ArrowUpRight size={12} />
                    </a>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      <section className="panel">
        <PanelHead title="Крупнейшие держатели" count={holders.length}>
          <button className="btn btn-ghost" onClick={() => c.go("registry")}>
            Реестр держателей <ArrowRight size={15} />
          </button>
        </PanelHead>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Держатель</th>
                <th className="num">Облигаций</th>
                <th className="num">По номиналу, TEST USD</th>
                <th className="num">Доля</th>
              </tr>
            </thead>
            <tbody>
              {holders.slice(0, 5).map((h) => {
                const share = Number(s.supply) ? (Number(h.units) / Number(s.supply)) * 100 : 0;
                return (
                  <tr key={h.wallet}>
                    <td>{holderName(s, h.index)}</td>
                    <td className="num">{units(h.units)}</td>
                    <td className="num">{money(BigInt(h.units) * BigInt(s.face))}</td>
                    <td className="num">
                      <div className="share">
                        {share.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%
                        <span className="bar">
                          <i style={{ width: `${share}%` }} />
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
