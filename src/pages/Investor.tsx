import { useEffect, useState } from "react";
import type { Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  ArrowUpRight,
  CheckCheck,
  Clock3,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import type { Ctx } from "../ctx";
import { actionTitle, holderName, symbolOf } from "../domain";
import { money, short, units } from "../format";
import { CustomSelect } from "../CustomSelect";
import { Empty, Kpi, PanelHead } from "../ui";
import { explorer, post } from "../api";

type Provider = {
  publicKey?: { toBase58(): string } | null;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signTransaction(tx: Transaction): Promise<Transaction>;
  on?(event: string, callback: (...args: any[]) => void): void;
  removeListener?(event: string, callback: (...args: any[]) => void): void;
};

export function Investor(c: Ctx) {
  const { s } = c;
  const [demo, setDemo] = useState(Math.min(2, s.holders.length - 1)),
    [address, setAddress] = useState<string | null>(null),
    [provider, setProvider] = useState<Provider | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const w = window as any;
    const connected: Provider | undefined = [
      w.phantom?.solana,
      w.solflare,
    ].find((p) => p?.publicKey);
    if (connected?.publicKey) {
      setProvider(connected);
      setAddress(connected.publicKey.toBase58());
    }
  }, []);
  useEffect(() => {
    if (!provider) return;
    const changed = (key: { toBase58(): string } | null) =>
      setAddress(key?.toBase58() ?? null);
    const disconnected = () => setAddress(null);
    provider.on?.("accountChanged", changed);
    provider.on?.("disconnect", disconnected);
    return () => {
      provider.removeListener?.("accountChanged", changed);
      provider.removeListener?.("disconnect", disconnected);
    };
  }, [provider]);
  async function connect(name: "phantom" | "solflare") {
    const w = window as any;
    const p: Provider | undefined =
      name === "phantom" ? w.phantom?.solana : w.solflare;
    if (!p) {
      c.notify(
        `Расширение ${name === "phantom" ? "Phantom" : "Solflare"} не найдено. Откройте страницу в браузере с установленным кошельком.`,
      );
      return;
    }
    setBusy(true);
    try {
      const result = await p.connect();
      setProvider(p);
      setAddress(result.publicKey.toBase58());
    } catch (e) {
      c.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const holder = address
    ? s.holders.find((h) => h.wallet === address)
    : s.holders[demo];
  const balances = holder ? s.balances?.holders[holder.index] : null;
  const rows = holder
    ? s.actions.flatMap((a) =>
        a.rows
          .filter((r) => r.holder === holder.index)
          .map((r) => ({ ...r, action: a })),
      )
    : [];
  const pending = rows
    .filter((r) => !r.settled)
    .reduce((n, r) => n + BigInt(r.amount), 0n);
  const paid = rows
    .filter((r) => r.settled)
    .reduce((n, r) => n + BigInt(r.amount), 0n);
  const current = s.actions.at(-1);
  const claimable =
    current &&
    [2, 3].includes(current.status) &&
    current.rows.some((r) => r.holder === holder?.index && !r.settled);
  async function claim() {
    if (c.readOnly) return;
    if (!holder) return;
    setBusy(true);
    try {
      if (address && provider) {
        const { Transaction } = await import("@solana/web3.js");
        const prepared = await post(
          "wallet/prepare",
          { wallet: address },
          s.config.state,
        );
        const tx = Transaction.from(
          Buffer.from(prepared.transaction, "base64"),
        );
        const signed = await provider.signTransaction(tx);
        await post(
          "wallet/submit",
          {
            id: prepared.id,
            transaction: Buffer.from(signed.serialize()).toString("base64"),
          },
          s.config.state,
        );
      } else
        await post(
          "action",
          { operation: "confirm", holder: holder.index },
          s.config.state,
        );
      await c.refresh();
      c.notify("TEST USD зачислены. Выплата записана в программе Solana.");
    } catch (e) {
      c.notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            <b>{symbolOf(s)}</b> · кабинет инвестора
          </div>
          <h1>Кабинет инвестора</h1>
          <p className="page-sub">
            Облигации, начисления и получение выплат от лица держателя.
          </p>
        </div>
        <div className="page-actions">
          <button
            className="btn btn-primary"
            disabled={c.readOnly || busy || !claimable}
            onClick={claim}
            title={claimable ? undefined : "Нет выплаты, ожидающей получения"}
          >
            <CheckCheck size={16} />
            {address ? "Подписать получение" : "Получить выплату"}
          </button>
        </div>
      </div>

      <div className="grid main-side">
        <div className="stack">
          <div className="kpis tight">
            <Kpi
              label={`Облигации ${symbolOf(s)}`}
              value={units(balances?.bonds ?? holder?.units ?? "0")}
              unit="шт."
            />
            <Kpi label="Баланс TEST USD" value={money(balances?.cash ?? "0")} />
            <Kpi
              label="К получению"
              value={money(pending)}
              tone={pending ? "good" : undefined}
            />
            <Kpi label="Получено всего" value={money(paid)} />
          </div>
          <section className="panel">
            <PanelHead
              title="Начисления"
              count={rows.length}
              sub="Строки появляются после фиксации реестра"
            />
            {rows.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Событие</th>
                      <th className="num">Облигаций на дату</th>
                      <th className="num">TEST USD</th>
                      <th>Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.action.id}>
                        <td>{actionTitle(r.action)}</td>
                        <td className="num">{units(r.units)}</td>
                        <td className="num">{money(r.amount)}</td>
                        <td>
                          <span
                            className={`badge ${r.settled ? "ok" : r.action.status === 1 ? "" : "info"}`}
                          >
                            {r.settled
                              ? "Зачислено"
                              : r.action.status === 1
                                ? "Ожидает расчёта"
                                : "Готово к получению"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty icon={<Clock3 size={28} />} title="Начислений пока нет">
                <p>
                  Они появятся, когда эмитент зафиксирует реестр для купона или
                  погашения.
                </p>
              </Empty>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <PanelHead title="Держатель">
              <Wallet size={18} />
            </PanelHead>
            <div className="panel-body stack" style={{ gap: 14 }}>
              {address ? (
                <div className="rows">
                  <div>
                    <span>Кошелёк</span>
                    <b className="mono">{short(address)}</b>
                  </div>
                  <div>
                    <span />
                    <button
                      className="btn btn-ghost"
                      onClick={async () => {
                        await provider?.disconnect();
                        setAddress(null);
                      }}
                    >
                      Отключить
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="page-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => connect("phantom")}
                    >
                      Phantom <ArrowUpRight size={14} />
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => connect("solflare")}
                    >
                      Solflare <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <label className="field">
                    Или тестовый держатель
                    <CustomSelect
                      label="Тестовый держатель"
                      value={demo}
                      onChange={setDemo}
                      options={s.holders.map((h) => ({
                        value: h.index,
                        label: holderName(s, h.index),
                      }))}
                    />
                  </label>
                </>
              )}
              {holder ? (
                <div className="field">
                  Адрес в реестре
                  <code className="signature">{holder.wallet}</code>
                </div>
              ) : (
                <div className="notice info">
                  <Wallet size={16} />
                  <span className="grow">
                    <b>Кошелька нет в реестре.</b> Создайте тестовый выпуск:
                    этот адрес получит 100 облигаций.
                    <br />
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ marginTop: 10 }}
                      disabled={c.readOnly || busy}
                      onClick={() => c.newDemo(address!)}
                    >
                      Получить тестовые облигации
                    </button>
                  </span>
                </div>
              )}
              <div className="notice">
                <ShieldCheck size={16} />
                <span>
                  {c.readOnly
                    ? "Публичный просмотр балансов и начислений. Получение выплат доступно в локальной доверенной среде."
                    : address
                      ? "Подпись запрашивается в вашем кошельке, комиссию оплачивает тестовый эмитент. Приватный ключ не передаётся."
                      : "Тестовый режим: ключи тестовых держателей хранит локальный сервер, выплату подписывает оператор."}
                </span>
              </div>
            </div>
          </section>
          {s.tokens?.enabled && (
            <section className="panel">
              <PanelHead title="Проверяемые счета" />
              <div className="panel-body rows">
                {[
                  ["Облигация, Token-2022", s.tokens.bondMint],
                  ["TEST USD, SPL Token", s.tokens.cashMint],
                  ["Escrow выпуска", s.tokens.vault],
                ].map(([label, key]) => (
                  <div key={key}>
                    <span>{label}</span>
                    <a
                      href={explorer("address", key)}
                      target="_blank"
                      rel="noreferrer"
                      className="mono"
                    >
                      {short(key)} <ArrowUpRight size={12} />
                    </a>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
