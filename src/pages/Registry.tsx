import { useState } from "react";
import { ArrowLeftRight, Copy, Fingerprint, Lock, Search } from "lucide-react";
import type { Ctx } from "../ctx";
import { holderName, symbolOf } from "../domain";
import { initials, money, short, units } from "../format";
import { Kpi, PanelHead } from "../ui";

export function Registry(c: Ctx) {
  const { s, now } = c;
  const [query, setQuery] = useState("");
  const current = s.actions.at(-1);
  const active = !!current && current.status < 4;
  const locked =
    s.holders.length < 2
      ? "Для перевода нужны минимум два держателя"
      : now >= s.maturity
        ? "Срок обращения истёк, переводы закрыты"
        : active && now >= current.recordAt
          ? "Переводы заблокированы до завершения текущего действия"
          : "";
  const rows = s.holders.filter((h) =>
    `${holderName(s, h.index)} ${h.wallet}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const cash = (i: number) => s.balances?.holders[i]?.cash ?? "0";
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            <b>{symbolOf(s)}</b> · реестр
          </div>
          <h1>Реестр держателей</h1>
          <p className="page-sub">
            Закрытый реестр в аккаунте программы. Счета облигаций заморожены,
            переводы идут только через программу.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-primary"
            disabled={c.readOnly || c.busy || !!locked}
            title={locked || undefined}
            onClick={c.openTransfer}
          >
            <ArrowLeftRight size={16} />
            Перевод облигаций
          </button>
        </div>
      </div>
      {locked && (
        <div className="notice warn">
          <Lock size={16} />
          <span>{locked}</span>
        </div>
      )}
      <div className="kpis">
        <Kpi
          label="Облигаций в обращении"
          value={units(s.supply)}
          unit={symbolOf(s)}
        />
        <Kpi label="Погашено" value={units(s.retired)} unit="обл." />
        <Kpi
          label="Держателей с остатком"
          value={s.holders.filter((h) => BigInt(h.units) > 0n).length}
          note={`из ${s.holders.length} в реестре`}
        />
      </div>
      <section className="panel">
        <PanelHead title="Держатели" count={s.holders.length}>
          <label className="search">
            <Search size={14} />
            <input
              placeholder="Имя или адрес"
              aria-label="Поиск держателя"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </PanelHead>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Держатель</th>
                <th>Адрес Solana</th>
                <th className="num">Облигаций</th>
                <th className="num">По номиналу, TEST USD</th>
                <th className="num">Получено, TEST USD</th>
                <th className="num">Доля выпуска</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => {
                const share = Number(s.supply)
                  ? (Number(h.units) / Number(s.supply)) * 100
                  : 0;
                const name = holderName(s, h.index);
                return (
                  <tr key={h.wallet}>
                    <td>
                      <div className="who">
                        <span className="avatar">{initials(name)}</span>
                        <span>
                          {name}
                          <span className="sub">
                            {s.config.names[h.index]
                              ? "Держатель"
                              : "Внешний кошелёк"}{" "}
                            #{h.index + 1}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <button
                        className="addr"
                        title={h.wallet}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(h.wallet);
                            c.notify("Адрес скопирован");
                          } catch {
                            c.notify(
                              "Не удалось скопировать адрес. Откройте его в Explorer.",
                            );
                          }
                        }}
                      >
                        {short(h.wallet)} <Copy size={12} />
                      </button>
                    </td>
                    <td className="num">{units(h.units)}</td>
                    <td className="num">
                      {money(BigInt(h.units) * BigInt(s.face))}
                    </td>
                    <td className="num">{money(cash(h.index))}</td>
                    <td className="num">
                      <div className="share">
                        {share.toLocaleString("ru-RU", {
                          maximumFractionDigits: 1,
                        })}
                        %
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
        <div className="panel-foot">
          <span>
            <Fingerprint size={13} style={{ verticalAlign: -2 }} /> Источник:
            аккаунт программы и счета Token-2022 в Devnet
          </span>
          <span>
            Реестр{" "}
            {s.balances &&
            s.holders.every((h, i) => h.units === s.balances!.holders[i]?.bonds)
              ? "совпадает"
              : "не совпадает"}{" "}
            с балансами токенов
          </span>
        </div>
      </section>
    </div>
  );
}
