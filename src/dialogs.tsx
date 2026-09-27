import { useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Download,
  Info,
  LoaderCircle,
} from "lucide-react";
import { CustomSelect } from "./CustomSelect";
import { Dialog } from "./ui";
import {
  allCouponsPaid,
  couponPaid,
  dueOf,
  entitlement,
  holderName,
  KINDS,
  nameOf,
  retireUnits,
  symbolOf,
  total,
  unpaidPeriods,
  type State,
} from "./domain";
import { dateTime, money, pct, units } from "./format";
import { explorer } from "./api";

export function ActionDialog({
  s,
  now,
  busy,
  initialKind,
  onClose,
  act,
}: {
  s: State;
  now: number;
  busy: boolean;
  initialKind: number;
  onClose(): void;
  act(body: object): Promise<boolean>;
}) {
  const [kind, setKind] = useState(initialKind),
    [period, setPeriod] = useState(unpaidPeriods(s)[0] ?? 1),
    [bps, setBps] = useState(2000);
  const current = s.actions.at(-1);
  const active = !!current && current.status < 4;
  const allCoupons = allCouponsPaid(s);
  // Nearest record date the program accepts, with room for confirmation.
  const recordAt = Math.max(
    now + 30,
    kind === 0 ? dueOf(s, period) : kind === 1 ? s.maturity : now + 4,
  );
  const wholeBond = s.holders.some((h) => BigInt(h.units) * BigInt(bps) >= 10000n);
  const expected = total(s, kind, bps);
  const escrow = BigInt(s.balances?.escrow ?? 0);
  const problems = [
    active && "Сначала завершите или отмените текущее действие.",
    s.supply === "0" && "Все облигации погашены.",
    kind === 0 && allCoupons && "Все купоны уже выплачены.",
    kind === 1 &&
      !allCoupons &&
      `Перед погашением выплатите все ${s.periods} купонов, включая последний.`,
    kind === 2 &&
      !wholeBond &&
      `При доле ${bps / 100}% ни у одного держателя не погашается целая облигация.`,
    kind === 2 && recordAt >= s.maturity && "Срок выпуска наступил: частичное погашение недоступно.",
  ].filter(Boolean) as string[];
  return (
    <Dialog
      wide
      title="Новое корпоративное действие"
      subtitle={`${symbolOf(s)} · ${nameOf(s)}`}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <span className="hint spacer">
            Действие записывается в программу Solana Devnet
          </span>
          <button className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || problems.length > 0}
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
            {busy && <LoaderCircle className="spin" size={16} />}
            Запланировать
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field">
          Тип действия
          <CustomSelect
            label="Тип действия"
            value={kind}
            onChange={setKind}
            options={KINDS.map((label, value) => ({ value, label }))}
          />
        </label>
        {kind === 0 && (
          <label className="field">
            Купонный период
            <CustomSelect
              label="Купонный период"
              value={period}
              onChange={setPeriod}
              options={Array.from({ length: s.periods }, (_, i) => ({
                value: i + 1,
                label: `№${i + 1} · ${dateTime(dueOf(s, i + 1))}${couponPaid(s, i + 1) ? " · выплачен" : ""}`,
                disabled: couponPaid(s, i + 1),
              }))}
            />
          </label>
        )}
        {kind === 2 && (
          <label className="field">
            Доля к погашению
            <CustomSelect
              label="Доля к погашению"
              value={bps}
              onChange={setBps}
              options={[1000, 2000, 2500, 5000].map((value) => ({
                value,
                label: `${value / 100}% облигаций каждого держателя`,
              }))}
            />
          </label>
        )}
        {kind === 1 && (
          <div className="field">
            Объём погашения
            <span className="help">
              Все {units(s.supply)} облигаций в обращении по номиналу
            </span>
          </div>
        )}
      </div>
      <div className="summary rows">
        <div>
          <span>Сумма к выплате</span>
          <b className="total">
            {money(expected)} <span className="unit">TEST USD</span>
          </b>
        </div>
        <div>
          <span>Формула</span>
          <b className="formula">
            {kind === 0
              ? `облигации × ${money(s.face)} × ${pct(s.couponBps)} ÷ ${s.frequency}`
              : kind === 2
                ? `⌊облигации × ${bps / 100}%⌋ × ${money(s.face)}`
                : `облигации × ${money(s.face)}`}
          </b>
        </div>
        <div>
          <span>Дата фиксации реестра</span>
          <b>{dateTime(recordAt)}</b>
        </div>
        <div>
          <span>Escrow</span>
          <b className={expected > escrow ? "down" : "up"}>
            {money(escrow)} {expected > escrow ? "· недостаточно" : "· покрывает"}
          </b>
        </div>
      </div>
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Держатель</th>
                <th className="num">Облигаций</th>
                {kind !== 0 && <th className="num">К погашению</th>}
                <th className="num">TEST USD</th>
              </tr>
            </thead>
            <tbody>
              {s.holders
                .filter((h) => BigInt(h.units) > 0n)
                .map((h) => (
                  <tr key={h.wallet}>
                    <td>{holderName(s, h.index)}</td>
                    <td className="num">{units(h.units)}</td>
                    {kind !== 0 && (
                      <td className="num">{units(retireUnits(h.units, kind, bps))}</td>
                    )}
                    <td className="num">{money(entitlement(s, h.units, kind, bps))}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="hint">
        Распределение по текущему реестру. Окончательные права фиксируются на дату
        фиксации, после неё переводы блокируются.
      </p>
      {problems.map((p) => (
        <div className="notice warn" key={p}>
          <AlertTriangle size={16} />
          <span>{p}</span>
        </div>
      ))}
    </Dialog>
  );
}

export function TransferDialog({
  s,
  busy,
  onClose,
  act,
}: {
  s: State;
  busy: boolean;
  onClose(): void;
  act(body: object): Promise<boolean>;
}) {
  const [t, setT] = useState({ from: 0, to: 1, units: 10 });
  const available = Number(s.holders[t.from]?.units ?? 0);
  const valid =
    t.from !== t.to && Number.isInteger(t.units) && t.units >= 1 && t.units <= available;
  return (
    <Dialog
      title="Перевод облигаций"
      subtitle="Перевод исполняет программа с подписью держателя-отправителя"
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <button className="btn btn-secondary" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || !valid}
            onClick={() => act({ operation: "transfer", ...t })}
          >
            {busy && <LoaderCircle className="spin" size={16} />}
            Подписать и перевести
          </button>
        </>
      }
    >
      <label className="field">
        Отправитель
        <CustomSelect
          label="Отправитель"
          value={t.from}
          onChange={(from) => setT({ ...t, from })}
          options={s.holders.map((h) => ({
            value: h.index,
            label: `${holderName(s, h.index)} · ${units(h.units)} ${symbolOf(s)}`,
          }))}
        />
      </label>
      <label className="field">
        Получатель
        <CustomSelect
          label="Получатель"
          value={t.to}
          onChange={(to) => setT({ ...t, to })}
          options={s.holders.map((h) => ({
            value: h.index,
            label: holderName(s, h.index),
            disabled: h.index === t.from,
          }))}
        />
      </label>
      <label className="field">
        Количество облигаций
        <input
          type="number"
          min={1}
          max={available}
          value={t.units}
          onChange={(e) => setT({ ...t, units: Number(e.target.value) })}
        />
        <span className="help">Доступно: {units(available)}</span>
      </label>
    </Dialog>
  );
}

export function AboutDialog({ s, onClose }: { s: State | null; onClose(): void }) {
  return (
    <Dialog
      title="О прототипе"
      subtitle="Хакатонная разработка для трека KASE × Superteam Kazakhstan"
      onClose={onClose}
      footer={
        s && (
          <a
            className="btn btn-secondary"
            href={`/api/export?issue=${encodeURIComponent(s.config.state)}`}
            download
          >
            <Download size={16} />
            Выгрузить аудит выпуска
          </a>
        )
      }
    >
      <div className="notice ok">
        <CheckCircle2 size={16} />
        <span>
          <b>Исполняется в Solana.</b> Облигации Token-2022 и закрытый реестр,
          блокировка переводов на дату фиксации, снимок держателей, целочисленные
          начисления, купоны, частичное и полное погашение, отмена неоплаченного
          действия и возврат остатка escrow. Повторная выплата исключена программой.
        </span>
      </div>
      <div className="notice info">
        <Info size={16} />
        <span>
          <b>Тестовая среда.</b> Все операции идут в публичной сети Devnet. TEST USD -
          тестовый токен без денежного обеспечения. Ключи тестовых держателей хранит
          локальный сервер; подключённый кошелёк подписывает получение сам.
        </span>
      </div>
      <div className="notice warn">
        <AlertTriangle size={16} />
        <span>
          <b>Ограничения.</b> До 16 держателей и 16 действий на выпуск. Нет
          интеграции с KASE, банком и KYC, один оператор без мультиподписи. Частичное
          погашение округляется вниз до целой облигации, выплаты - до микро-единицы.
        </span>
      </div>
    </Dialog>
  );
}

export function TxDialog({
  tx,
  onClose,
}: {
  tx: { signature: string; slot: number; meta?: { err: unknown; logMessages?: string[] } };
  onClose(): void;
}) {
  return (
    <Dialog
      wide
      title="Транзакция Solana"
      subtitle={`Devnet · слот ${units(tx.slot)}`}
      onClose={onClose}
      footer={
        <a
          className="btn btn-secondary"
          href={explorer("tx", tx.signature)}
          target="_blank"
          rel="noreferrer"
        >
          Открыть в Solana Explorer <ArrowUpRight size={15} />
        </a>
      }
    >
      <div>
        <span className={`badge ${tx.meta?.err ? "bad" : "ok"}`}>
          {tx.meta?.err ? "Ошибка исполнения" : "Исполнена успешно"}
        </span>
      </div>
      <label className="field">
        Подпись
        <code className="signature">{tx.signature}</code>
      </label>
      <div className="field">
        Журнал программы
        <pre className="logs">
          {tx.meta?.logMessages?.join("\n") ?? "Журнал недоступен"}
        </pre>
      </div>
    </Dialog>
  );
}
