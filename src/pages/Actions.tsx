import { useState } from "react";
import { ArrowRight, Check, CheckCheck, ListChecks, Plus, ShieldCheck, X } from "lucide-react";
import type { Ctx } from "../ctx";
import {
  actionCode,
  actionSum,
  actionTitle,
  holderName,
  STEPS,
  symbolOf,
  type Action,
} from "../domain";
import { dateTime, money, span, units } from "../format";
import { Empty, PanelHead, Status } from "../ui";

export function Actions(c: Ctx) {
  const { s } = c;
  const [selected, setSelected] = useState<number | null>(null);
  const current = s.actions.at(-1);
  const active = !!current && current.status < 4;
  const action = s.actions.find((a) => a.id === selected) ?? current;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            <b>{symbolOf(s)}</b> · корпоративные действия
          </div>
          <h1>Корпоративные действия</h1>
          <p className="page-sub">
            Купоны и погашения: дата фиксации, снимок реестра, расчёт и выплаты в
            TEST USD.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-primary"
            disabled={c.busy || active || s.supply === "0"}
            onClick={() => c.openAction()}
          >
            <Plus size={16} />
            Новое действие
          </button>
        </div>
      </div>

      <section className="panel">
        <PanelHead title="Журнал действий" count={s.actions.length} sub="Одно действие исполняется за раз; выберите строку для подробностей" />
        {s.actions.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Событие</th>
                  <th>Дата фиксации</th>
                  <th className="num">Получателей</th>
                  <th className="num">Сумма, TEST USD</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {[...s.actions].reverse().map((a) => (
                  <tr
                    key={a.id}
                    className={`clickable ${a.id === action?.id ? "selected" : ""}`}
                    onClick={() => setSelected(a.id)}
                  >
                    <td className="mono">{actionCode(a)}</td>
                    <td>{actionTitle(a)}</td>
                    <td className="nowrap">{dateTime(a.recordAt)}</td>
                    <td className="num">{a.rows.length || "-"}</td>
                    <td className="num">{a.rows.length ? money(actionSum(a)) : "после фиксации"}</td>
                    <td>
                      <Status status={a.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<ListChecks size={30} />} title="Действий пока нет">
            <p>Запланируйте купон: реестр зафиксируется на дату фиксации, затем программа рассчитает выплаты.</p>
            <button className="btn btn-primary" onClick={() => c.openAction()}>
              Запланировать купон <ArrowRight size={16} />
            </button>
          </Empty>
        )}
      </section>

      {action && <ActionDetail c={c} a={action} />}
    </div>
  );
}

function ActionDetail({ c, a }: { c: Ctx; a: Action }) {
  const { s, now, busy } = c;
  const [cancelling, setCancelling] = useState(false);
  const isLatest = a.id === s.actions.at(-1)?.id;
  const retire = a.rows.reduce((n, r) => n + BigInt(r.retireUnits), 0n);
  const settled = a.rows.filter((r) => r.settled).length;
  // Steps: record date reached, snapshot, initiation, all payments.
  const done = [
    a.status >= 1 || now >= a.recordAt,
    a.status >= 1,
    a.status >= 2,
    a.status === 4,
  ];
  const currentStep = done.indexOf(false);
  const cancellable = isLatest && a.status < 3 && a.rows.every((r) => !r.settled);
  return (
    <section className="panel">
      <div className="detail-head">
        <div>
          <h2>{actionTitle(a)}</h2>
          <p>
            {actionCode(a)} · {symbolOf(s)}
          </p>
        </div>
        <Status status={a.status} />
      </div>
      <dl className="kv">
        <div>
          <dt>Дата фиксации</dt>
          <dd>{dateTime(a.recordAt)}</dd>
        </div>
        <div>
          <dt>Снимок реестра</dt>
          <dd>{a.snapshotSlot !== "0" ? `слот ${units(a.snapshotSlot)}` : "не сделан"}</dd>
        </div>
        <div>
          <dt>Сумма расчёта</dt>
          <dd>
            {a.rows.length ? money(actionSum(a)) : "после фиксации"} {a.rows.length > 0 && <small>TEST USD</small>}
          </dd>
        </div>
        <div>
          <dt>Выплачено</dt>
          <dd>
            {a.rows.length ? `${settled} из ${a.rows.length}` : "после фиксации"}
          </dd>
        </div>
        {a.kind !== 0 && (
          <div>
            <dt>Облигаций к погашению</dt>
            <dd>{a.rows.length ? units(retire) : "после фиксации"}</dd>
          </div>
        )}
      </dl>
      <div className="panel-body">
        <div className="stepper">
          {STEPS.map((label, i) => (
            <div
              key={label}
              className={`step ${done[i] ? "done" : i === currentStep ? "current" : ""}`}
            >
              <i>{done[i] ? <Check size={13} /> : i + 1}</i>
              {label}
            </div>
          ))}
        </div>
      </div>
      <div className="detail-bar">
        <span className="status-line">
          <ShieldCheck size={16} />
          {a.status === 4
            ? "Все выплаты проведены и записаны в программе"
            : a.snapshotSlot !== "0"
              ? `Реестр зафиксирован в слоте ${units(a.snapshotSlot)}; переводы заблокированы до завершения`
              : now < a.recordAt
                ? (
                  <>
                    До даты фиксации <span className="countdown">{span(a.recordAt - now)}</span>
                  </>
                )
                : "Дата фиксации наступила, переводы заблокированы"}
        </span>
        {isLatest && a.status === 0 && (
          <button
            className="btn btn-primary"
            disabled={busy || now < a.recordAt}
            onClick={() => c.act({ operation: "snapshot" })}
          >
            Зафиксировать реестр <ArrowRight size={15} />
          </button>
        )}
        {isLatest && a.status === 1 && (
          <button className="btn btn-primary" disabled={busy} onClick={() => c.act({ operation: "initiate" })}>
            Инициировать расчёт <ArrowRight size={15} />
          </button>
        )}
        {a.status === 4 && (
          <span className="badge ok">
            <CheckCheck size={13} /> Исполнено
          </span>
        )}
      </div>
      {cancellable &&
        (cancelling ? (
          <div className="confirm-row">
            <span>Отменить действие? Дата фиксации снимется, переводы снова станут доступны.</span>
            <button className="btn btn-sm btn-secondary" disabled={busy} onClick={() => setCancelling(false)}>
              Нет
            </button>
            <button
              className="btn btn-sm btn-danger"
              disabled={busy}
              onClick={async () => {
                await c.act({ operation: "cancel" });
                setCancelling(false);
              }}
            >
              Да, отменить
            </button>
          </div>
        ) : (
          <div className="panel-foot">
            <span>Действие можно отменить, пока по нему нет выплат.</span>
            <button className="btn btn-quiet-danger" disabled={busy} onClick={() => setCancelling(true)}>
              <X size={14} /> Отменить действие
            </button>
          </div>
        ))}
      {a.rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Держатель</th>
                <th className="num">Облигаций на дату</th>
                {a.kind !== 0 && <th className="num">К погашению</th>}
                <th className="num">Начислено, TEST USD</th>
                <th>Выплата</th>
              </tr>
            </thead>
            <tbody>
              {a.rows.map((r) => (
                <tr key={r.holder}>
                  <td>{holderName(s, r.holder)}</td>
                  <td className="num">{units(r.units)}</td>
                  {a.kind !== 0 && <td className="num">{units(r.retireUnits)}</td>}
                  <td className="num">{money(r.amount)}</td>
                  <td>
                    {r.settled ? (
                      <span className="badge ok">Выплачено</span>
                    ) : isLatest && a.status >= 2 ? (
                      <button
                        className="btn btn-sm btn-secondary"
                        disabled={busy}
                        onClick={() => c.act({ operation: "confirm", holder: r.holder })}
                      >
                        Выплатить
                      </button>
                    ) : (
                      <span className="badge">Ожидает инициации</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
