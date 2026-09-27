import { CustomSelect } from "./CustomSelect";
import { useEffect, useState } from "react";
import {
  Wallet,
  ArrowUpRight,
  ShieldCheck,
  Coins,
  Clock3,
  ArrowRight,
  CheckCheck,
} from "lucide-react";
import { Transaction } from "@solana/web3.js";
import { Buffer } from "buffer";
import type { State } from "./main";

type Provider = {
  publicKey?: { toBase58(): string };
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  disconnect(): Promise<void>;
  signTransaction(tx: Transaction): Promise<Transaction>;
  on?(event: string, callback: (...args: any[]) => void): void;
  removeListener?(event: string, callback: (...args: any[]) => void): void;
};
const money = (v: string | bigint) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(
    Number(v) / 1e6,
  );
const short = (v: string) => `${v.slice(0, 6)}…${v.slice(-6)}`;
export async function post(path: string, body: object = {}, issueId?: string) {
  const r = await fetch(`/api/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(issueId ? { "X-Instrument-ID": issueId } : {}),
    },
    body: JSON.stringify(body),
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Запрос не выполнен");
  return result;
}
export function Investor({
  s,
  refresh,
  notify,
  newDemo,
}: {
  s: State;
  refresh(): Promise<void>;
  notify(message: string): void;
  newDemo(wallet?: string): Promise<void>;
}) {
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
      notify(
        `Откройте демо в браузере с расширением ${name === "phantom" ? "Phantom" : "Solflare"}. Встроенный браузер может не поддерживать расширения.`,
      );
      return;
    }
    setBusy(true);
    try {
      const result = await p.connect();
      setProvider(p);
      setAddress(result.publicKey.toBase58());
    } catch (e) {
      notify((e as Error).message);
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
    if (!holder) return;
    setBusy(true);
    try {
      if (address && provider) {
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
      await refresh();
      notify("TEST USD зачислены. Результат записан в программе Solana.");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="investor-layout">
      <section className="panel investor-identity">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</span>
            <h2>Ваши права. Ваши выплаты.</h2>
          </div>
          <Wallet size={26} />
        </div>
        <p className="muted">
          Подключите кошелёк или пройдите весь цикл от лица тестового инвестора.
        </p>
        {address ? (
          <div className="wallet-connected">
            <ShieldCheck size={18} />
            <code>{short(address)}</code>
            <button
              className="text-button"
              onClick={async () => {
                await provider?.disconnect();
                setAddress(null);
              }}
            >
              Отключить
            </button>
          </div>
        ) : (
          <div className="wallet-buttons">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => connect("phantom")}
            >
              Phantom <ArrowUpRight size={16} />
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => connect("solflare")}
            >
              Solflare <ArrowUpRight size={16} />
            </button>
          </div>
        )}
        {!address && (
          <label className="investor-select">
            Тестовый инвестор
            <CustomSelect
              label="Тестовый инвестор"
              value={demo}
              onChange={setDemo}
              options={s.holders.map((h) => ({
                value: h.index,
                label: s.config.names[h.index] || `Держатель ${h.index + 1}`,
              }))}
            />
          </label>
        )}
        {holder ? (
          <div className="wallet-address">
            <small>Адрес держателя</small>
            <code>{holder.wallet}</code>
          </div>
        ) : (
          <div className="investor-empty">
            <h3>У этого кошелька пока нет облигаций</h3>
            <p>
              Создайте новый тестовый выпуск: 100 тестовых облигаций будут
              зачислены на ваш адрес. Текущий выпуск останется в архиве.
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => newDemo(address!)}
            >
              Получить тестовые облигации <ArrowRight size={16} />
            </button>
          </div>
        )}
        <div className="investor-disclosure">
          <ShieldCheck size={17} />
          <span>
            {address
              ? "Подпись запрашивается в вашем кошельке. Комиссию оплачивает тестовый эмитент."
              : "Демо-режим: ключи тестовых инвесторов хранит локальный сервер; выплату подписывает оператор."}{" "}
          </span>
        </div>
      </section>
      <div className="investor-metrics">
        <section className="panel">
          <Coins size={20} />
          <small>Облигации {s.config.metadata?.symbol ?? "STPE.28"}</small>
          <strong>{balances?.bonds ?? holder?.units ?? "0"}</strong>
          <span>
            Token-2022 ·{" "}
            {balances?.frozen ? "переводы через реестр" : "тестовый выпуск"}
          </span>
        </section>
        <section className="panel">
          <Wallet size={20} />
          <small>Баланс TEST USD</small>
          <strong>{money(balances?.cash ?? "0")}</strong>
          <span>Тестовый токен без денежного обеспечения</span>
        </section>
        <section className="panel">
          <Clock3 size={20} />
          <small>Начислено к получению</small>
          <strong>{money(pending)}</strong>
          <span>Получено за весь период: {money(paid)} TEST USD</span>
        </section>
      </div>
      <section className="panel investor-payments">
        <div className="section-heading">
          <div>
            <span className="eyebrow">ИСТОРИЯ НАЧИСЛЕНИЙ</span>
            <h2>От купона до погашения</h2>
          </div>
          <button
            className="button primary"
            disabled={busy || !claimable}
            onClick={claim}
          >
            {address ? "Подписать получение" : "Получить тестовую выплату"}
            <ArrowDownIcon />
          </button>
        </div>
        {rows.length ? (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Действие</th>
                  <th>Облигации на record date</th>
                  <th>TEST USD</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.action.id}>
                    <td>
                      {
                        ["Купон", "Полное погашение", "Частичное погашение"][
                          r.action.kind
                        ]
                      }{" "}
                      {r.action.kind === 0 ? `№${r.action.period}` : ""}
                    </td>
                    <td>{r.units}</td>
                    <td>{money(r.amount)}</td>
                    <td>
                      <span className={`badge ${r.settled ? "green" : ""}`}>
                        {r.settled
                          ? "Зачислено"
                          : r.action.status === 1
                            ? "Ожидает запуска"
                            : "Готово к выплате"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-investor">
            <Clock3 size={26} />
            <p>Начисления появятся после фиксации держателей.</p>
            <small>
              Создайте купонное действие или включите автопилот и перейдите к
              следующей дате.
            </small>
          </div>
        )}
      </section>
      {s.tokens?.enabled && (
        <section className="panel token-addresses">
          <h3>Проверяемые счета</h3>
          {[
            ["Облигация Token-2022", s.tokens.bondMint],
            ["TEST USD · SPL Token", s.tokens.cashMint],
            ["Escrow выпуска", s.tokens.vault],
          ].map(([label, key]) => (
            <div key={key}>
              <span>{label}</span>
              {s.config.network === "devnet" ? (
                <a
                  href={`https://explorer.solana.com/address/${key}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(key)} ↗
                </a>
              ) : (
                <code>{key}</code>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
function ArrowDownIcon() {
  return <CheckCheck size={17} />;
}

export function DemoControls({
  s,
  refresh,
  notify,
  busy,
}: {
  s: State;
  refresh(): Promise<void>;
  notify(message: string): void;
  busy: boolean;
}) {
  const [working, setWorking] = useState(false);
  async function run(path: string, body: object) {
    setWorking(true);
    try {
      await post(path, body, s.config.state);
      await refresh();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="demo-controls">
      <div className="demo-clock">
        <Clock3 size={19} />
        <div>
          <b>Время сети Devnet</b>
          <small>
            {new Date(s.chainTime * 1000).toLocaleString("ru-RU")} · время сети
          </small>
        </div>
      </div>
      <button
        className={`button ${s.automation?.enabled ? "primary" : "secondary"}`}
        aria-pressed={s.automation?.enabled ?? false}
        disabled={working || busy || !s.tokens?.enabled}
        onClick={() => run("automation", { enabled: !s.automation?.enabled })}
      >
        {s.automation?.enabled ? "Автопилот включён" : "Включить автопилот"}
      </button>
      {s.balances && (
        <div className="escrow-status">
          <b>{money(s.balances.escrow)} TEST USD</b>
          <small>В хранилище выплат</small>
          <button
            className="text-button"
            disabled={working || busy}
            onClick={() => run("fund", {})}
          >
            Пополнить тестовый баланс
          </button>
        </div>
      )}
      {s.automation?.error && (
        <p className="automation-error" role="status">
          {s.automation.error}
        </p>
      )}
    </section>
  );
}
