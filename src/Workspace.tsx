import { useEffect, useState, useRef } from "react";
import {
  ArrowRight,
  Plus,
  Check,
  FileCheck2,
  Landmark,
  Search,
  X,
  ExternalLink,
} from "lucide-react";
import { CustomSelect } from "./CustomSelect";
import { post } from "./Investor";

type Application = {
  name: string;
  wallet: string;
  units: number;
  admitted: boolean;
};
type Terms = {
  issuer: string;
  name: string;
  symbol: string;
  face: string;
  couponBps: number;
  frequency: number;
  periods: number;
  duration: number;
  supply: number;
  document: string;
  applications: Application[];
};
type Draft = {
  id: string;
  revision: number;
  status: string;
  terms: Terms;
  approval?: { hash: string };
  history: { event: string; at?: string; revision?: number }[];
  error?: string;
  issueId?: string;
  provisioning?: { config: { state: string } };
};
type Issue = {
  id: string;
  name: string;
  issuer: string;
  symbol: string;
  createdAt: string;
  stats?: {
    supply: string;
    paid: string;
    escrow: string;
    maturity: number;
    updatedAt: string;
  };
};
const fresh = (): Terms => ({
  issuer: "",
  name: "",
  symbol: "",
  face: "1000",
  couponBps: 1000,
  frequency: 2,
  periods: 4,
  duration: 86400,
  supply: 1000,
  document: "",
  applications: [
    { name: "Alatau Capital", wallet: "", units: 400, admitted: false },
    { name: "Steppe Ventures", wallet: "", units: 300, admitted: false },
    { name: "Aida S.", wallet: "", units: 200, admitted: false },
    { name: "Timur K.", wallet: "", units: 100, admitted: false },
  ],
});
const statusName: Record<string, string> = {
  draft: "Черновик",
  approved: "Проверен",
  publishing: "Размещение…",
  published: "Размещён",
  needs_review: "Требует проверки",
};
const cash = (n: bigint) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 }).format(
    Number(n) / 1e6,
  ) + " TEST USD";
export function Workspace({
  activeId,
  onSelect,
}: {
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const wizardRef = useRef<HTMLElement>(null);
  const [issues, setIssues] = useState<Issue[]>([]),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [editing, setEditing] = useState(false),
    [step, setStep] = useState(0),
    [terms, setTerms] = useState<Terms>(fresh),
    [draft, setDraft] = useState<Draft | null>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [search, setSearch] = useState("");
  useEffect(() => {
    wizardRef.current?.scrollTo(0, 0);
  }, [step]);
  async function refresh() {
    try {
      const r = await fetch("/api/workspace");
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setIssues(data.issues);
      setDrafts(data.drafts);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 10000);
    return () => clearInterval(t);
  }, []);
  const change = (patch: Partial<Terms>) => {
    setTerms({ ...terms, ...patch });
    setDirty(true);
    setError("");
  };
  function open(d?: Draft) {
    setDraft(d ?? null);
    setTerms(d ? structuredClone(d.terms) : fresh());
    setStep(d ? 2 : 0);
    setDirty(!d);
    setEditing(true);
    setError("");
  }
  const allocated = terms.applications.reduce(
    (n, a) => n + (Number.isFinite(a.units) ? a.units : 0),
    0,
  );
  let principal = 0n,
    coupon = 0n;
  try {
    const [whole, fraction = ""] = terms.face.split(".");
    const face =
      BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0").slice(0, 6));
    principal = BigInt(terms.supply || 0) * face;
    coupon = terms.applications.reduce(
      (n, a) =>
        n +
        (BigInt(a.units || 0) * face * BigInt(terms.couponBps || 0)) /
          (10000n * BigInt(terms.frequency)),
      0n,
    );
  } catch {}
  async function save() {
    setBusy(true);
    setError("");
    try {
      const d = await post("drafts", {
        id: draft?.id,
        revision: draft?.revision,
        terms,
      });
      setDraft(d);
      setDirty(false);
      await refresh();
      return d as Draft;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    const d = dirty || !draft ? await save() : draft;
    if (!d) return;
    setBusy(true);
    try {
      setDraft(await post(`drafts/${d.id}/approve`, { revision: d.revision }));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function publish() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const result = await post(`drafts/${draft.id}/publish`, {
        revision: draft.revision,
      });
      await refresh();
      setEditing(false);
      onSelect(result.issueId);
    } catch (e) {
      setError((e as Error).message);
      const r = await fetch("/api/workspace");
      const v = await r.json();
      const updated = v.drafts?.find((d: Draft) => d.id === draft.id);
      if (updated) setDraft(updated);
      await refresh();
    } finally {
      setBusy(false);
    }
  }
  async function reconcile() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      const v = await post(`drafts/${draft.id}/reconcile`, {});
      setEditing(false);
      onSelect(v.issueId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const editable = !draft || ["draft", "approved"].includes(draft.status);
  return (
    <section className="workspace-view">
      <div className="workspace-intro">
        <div>
          <span className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО ЭМИТЕНТА</span>
          <h2>От условий выпуска до последней выплаты</h2>
          <p>
            Сохраняйте условия, проверяйте распределение и размещайте облигации
            в Solana Devnet.
          </p>
        </div>
        <button className="button primary" onClick={() => open()}>
          <Plus size={17} />
          Создать выпуск
        </button>
      </div>
      {error && !editing && (
        <p className="workspace-error" role="alert">
          {error}
        </p>
      )}
      <div className="workspace-stat-row">
        <div>
          <strong>{issues.length}</strong>
          <span>Размещённых выпусков</span>
        </div>
        <div>
          <strong>
            {
              drafts.filter(
                (d) => d.status === "draft" || d.status === "approved",
              ).length
            }
          </strong>
          <span>В подготовке</span>
        </div>
        <div>
          <strong>
            {drafts.filter((d) => d.status === "needs_review").length}
          </strong>
          <span>Требуют проверки</span>
        </div>
      </div>
      <section className="panel">
        <div className="panel-head">
          <h3>Каталог выпусков</h3>
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Поиск выпусков"
              placeholder="Эмитент, название или тикер"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className="issue-grid">
          {issues
            .filter((i) =>
              `${i.name} ${i.symbol} ${i.issuer}`
                .toLowerCase()
                .includes(search.toLowerCase()),
            )
            .map((i) => (
              <article className="issue-card" key={i.id}>
                <div>
                  <span className="badge green">{i.symbol}</span>
                  <span className="muted">
                    {i.stats?.supply === "0"
                      ? "Погашен"
                      : i.stats
                        ? "В обращении"
                        : "Размещён"}
                  </span>
                </div>
                <h3>{i.name}</h3>
                <p>{i.issuer}</p>
                <small>
                  {i.stats
                    ? `Остаток: ${i.stats.supply} облигаций`
                    : "Данные сети загрузятся при открытии"}
                </small>
                <code>
                  {i.id.slice(0, 10)}…{i.id.slice(-6)}
                </code>
                <button
                  className="button secondary"
                  onClick={() => onSelect(i.id)}
                >
                  {i.id === activeId
                    ? "Открыть текущий выпуск"
                    : "Открыть выпуск"}
                  <ArrowRight size={16} />
                </button>
              </article>
            ))}
        </div>
        {!issues.filter((i) =>
          `${i.name} ${i.symbol} ${i.issuer}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        ).length && <p className="workspace-empty">Выпуски не найдены</p>}
      </section>
      <section className="panel">
        <div className="panel-head">
          <h3>Подготовка и согласование</h3>
          <span className="muted">Версии условий сохраняются</span>
        </div>
        {drafts.length ? (
          drafts.map((d) => (
            <button className="draft-row" key={d.id} onClick={() => open(d)}>
              <FileCheck2 size={21} />
              <span>
                <b>{d.terms.name}</b>
                <small>
                  {d.terms.issuer} · {d.terms.symbol} · версия {d.revision}
                </small>
              </span>
              <span
                className={`badge ${d.status === "needs_review" ? "amber" : "green"}`}
              >
                {statusName[d.status]}
              </span>
              <ArrowRight size={16} />
            </button>
          ))
        ) : (
          <p className="workspace-empty">
            Создайте первый черновик — условия и реестр можно подготовить до
            размещения.
          </p>
        )}
      </section>
      {editing && (
        <div className="modal-backdrop">
          <section
            ref={wizardRef}
            className="modal issue-wizard"
            role="dialog"
            aria-modal="true"
            aria-label="Создание выпуска"
          >
            <button
              className="modal-close"
              aria-label="Закрыть мастер"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">
              {draft
                ? `ВЕРСИЯ ${draft.revision} · ${statusName[draft.status]}`
                : "НОВЫЙ ВЫПУСК"}
            </span>
            <h2>{terms.name || "Подготовка выпуска"}</h2>
            <div className="wizard-steps">
              {["Условия", "Инвесторы", "Проверка"].map((n, i) => (
                <button
                  key={n}
                  className={step === i ? "active" : ""}
                  onClick={() => setStep(i)}
                >
                  {i + 1}. {n}
                </button>
              ))}
            </div>
            {error && (
              <p className="workspace-error" role="alert">
                {error}
              </p>
            )}
            {draft?.status === "needs_review" && (
              <div className="workspace-error">
                {draft.error}
                <p>
                  Автоматический повтор отключён, чтобы исключить повторное
                  размещение.
                </p>
                {draft.provisioning && (
                  <a
                    target="_blank"
                    rel="noreferrer"
                    href={`https://explorer.solana.com/address/${draft.provisioning.config.state}?cluster=devnet`}
                  >
                    Проверить аккаунт в Explorer <ExternalLink size={14} />
                  </a>
                )}
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void reconcile()}
                >
                  Сверить завершение с сетью
                </button>
              </div>
            )}
            <fieldset disabled={busy || !editable} className="wizard-fields">
              {step === 0 && (
                <>
                  <div className="form-grid">
                    <label>
                      Эмитент
                      <input
                        value={terms.issuer}
                        onChange={(e) => change({ issuer: e.target.value })}
                        placeholder="Название компании"
                      />
                    </label>
                    <label>
                      Название выпуска
                      <input
                        value={terms.name}
                        onChange={(e) => change({ name: e.target.value })}
                        placeholder="Облигации компании — серия 01"
                      />
                    </label>
                    <label>
                      Тикер
                      <input
                        value={terms.symbol}
                        onChange={(e) =>
                          change({ symbol: e.target.value.toUpperCase() })
                        }
                        placeholder="ENERGY.01"
                        maxLength={16}
                      />
                    </label>
                    <label>
                      Номинал, TEST USD
                      <input
                        inputMode="decimal"
                        value={terms.face}
                        onChange={(e) => change({ face: e.target.value })}
                      />
                    </label>
                    <label>
                      Объём, облигаций
                      <input
                        type="number"
                        min={1}
                        max={1000000}
                        value={terms.supply}
                        onChange={(e) =>
                          change({ supply: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Годовой купон, %
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        value={terms.couponBps / 100}
                        onChange={(e) =>
                          change({
                            couponBps: Math.round(Number(e.target.value) * 100),
                          })
                        }
                      />
                    </label>
                    <label>
                      Выплат в год
                      <CustomSelect
                        label="Выплат в год"
                        value={terms.frequency}
                        onChange={(frequency) => change({ frequency })}
                        options={[1, 2, 4, 12].map((value) => ({
                          value,
                          label: String(value),
                        }))}
                        disabled={busy || !editable}
                      />
                    </label>
                    <label>
                      Купонных периодов
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={terms.periods}
                        onChange={(e) =>
                          change({ periods: Number(e.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Срок в Devnet
                      <CustomSelect
                        label="Срок в Devnet"
                        value={terms.duration}
                        onChange={(duration) => change({ duration })}
                        options={[
                          { value: 300, label: "5 минут — демо" },
                          { value: 600, label: "10 минут — демо" },
                          { value: 3600, label: "1 час — демо" },
                          { value: 86400, label: "1 день — демо" },
                          { value: 2592000, label: "30 дней" },
                          { value: 31536000, label: "1 год" },
                          { value: 63072000, label: "2 года" },
                        ]}
                        disabled={busy || !editable}
                      />
                    </label>
                  </div>
                  <p className="muted">
                    Демо-срок сжимает календарь. Размер каждого купона
                    рассчитывается по ставке и частоте, без пропорционального
                    уменьшения.
                  </p>
                  <label>
                    Описание условий и документов
                    <textarea
                      rows={3}
                      value={terms.document}
                      maxLength={4000}
                      onChange={(e) => change({ document: e.target.value })}
                      placeholder="Назначение выпуска, условия, ссылки на документы"
                    />
                  </label>
                </>
              )}
              {step === 1 && (
                <>
                  <p>
                    Распределено <b>{allocated}</b> из <b>{terms.supply}</b>{" "}
                    облигаций. Допуск подтверждает оператор; внешняя
                    KYC-проверка не подключена.
                  </p>
                  {terms.applications.map((a, i) => (
                    <div className="allocation-row" key={i}>
                      <div className="form-grid">
                        <label>
                          Инвестор {i + 1}
                          <input
                            value={a.name}
                            onChange={(e) =>
                              change({
                                applications: terms.applications.map((x, j) =>
                                  j === i ? { ...x, name: e.target.value } : x,
                                ),
                              })
                            }
                          />
                        </label>
                        <label>
                          Облигаций
                          <input
                            type="number"
                            min={1}
                            value={a.units}
                            onChange={(e) =>
                              change({
                                applications: terms.applications.map((x, j) =>
                                  j === i
                                    ? { ...x, units: Number(e.target.value) }
                                    : x,
                                ),
                              })
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Кошелёк Solana — необязательно
                        <input
                          value={a.wallet}
                          onChange={(e) =>
                            change({
                              applications: terms.applications.map((x, j) =>
                                j === i ? { ...x, wallet: e.target.value } : x,
                              ),
                            })
                          }
                          placeholder="Пусто — создать тестовый кошелёк"
                        />
                      </label>
                      <div className="allocation-actions">
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={a.admitted}
                            onChange={(e) =>
                              change({
                                applications: terms.applications.map((x, j) =>
                                  j === i
                                    ? { ...x, admitted: e.target.checked }
                                    : x,
                                ),
                              })
                            }
                          />
                          Допуск подтверждён оператором
                        </label>
                        <button
                          className="text-button"
                          onClick={() =>
                            change({
                              applications: terms.applications.filter(
                                (_, j) => i !== j,
                              ),
                            })
                          }
                          disabled={terms.applications.length === 1}
                        >
                          Убрать
                        </button>
                      </div>
                    </div>
                  ))}
                  <button
                    className="button secondary"
                    disabled={terms.applications.length >= 16}
                    onClick={() =>
                      change({
                        applications: [
                          ...terms.applications,
                          { name: "", wallet: "", units: 1, admitted: false },
                        ],
                      })
                    }
                  >
                    <Plus size={16} />
                    Добавить инвестора
                  </button>
                  <p className="fine-print">
                    До 16 держателей на выпуск. Токены распределяются
                    непосредственно при размещении; оплата подписки инвестором
                    не реализована.
                  </p>
                </>
              )}
            </fieldset>
            {step === 2 && (
              <>
                <div className="review-terms">
                  <Landmark size={28} />
                  <div>
                    <h3>{terms.issuer || "Укажите эмитента"}</h3>
                    <p>
                      {terms.symbol} · {terms.supply} облигаций ·{" "}
                      {terms.applications.length} инвесторов
                    </p>
                  </div>
                </div>
                <div className="budget-grid">
                  <div>
                    <span>Основной долг</span>
                    <b>{cash(principal)}</b>
                  </div>
                  <div>
                    <span>Каждый купон</span>
                    <b>{cash(coupon)}</b>
                  </div>
                  <div>
                    <span>Полный бюджет выплат</span>
                    <b>
                      {cash(
                        principal +
                          coupon *
                            BigInt(
                              Number.isSafeInteger(terms.periods) &&
                                terms.periods > 0
                                ? terms.periods
                                : 0,
                            ),
                      )}
                    </b>
                  </div>
                </div>
                <p className="muted">
                  При размещении создаются Token-2022 облигации и escrow с
                  полным бюджетом в необеспеченных TEST USD. Комиссии
                  оплачиваются тестовыми SOL.
                </p>
                <div className="review-checks">
                  <span>
                    <Check size={16} />
                    {allocated === terms.supply
                      ? "Объём распределён полностью"
                      : "Исправьте распределение объёма"}
                  </span>
                  <span>
                    <Check size={16} />
                    {
                      terms.applications.filter((a) => a.admitted).length
                    } из {terms.applications.length} допусков подтверждены
                  </span>
                  <span>
                    <Check size={16} />
                    Условия после размещения неизменяемы
                  </span>
                </div>
                {draft?.approval && !dirty && (
                  <div className="approval-note">
                    Версия проверена оператором. Это локальное согласование, не
                    мультиподпись.<code>{draft.approval.hash}</code>
                  </div>
                )}
                {draft?.history?.length ? (
                  <details>
                    <summary>История версий и проверок</summary>
                    {draft.history.map((h, i) => (
                      <p key={i}>
                        {h.event} {h.revision ? `· версия ${h.revision}` : ""}{" "}
                        {h.at
                          ? `· ${new Date(h.at).toLocaleString("ru-RU")}`
                          : ""}
                      </p>
                    ))}
                  </details>
                ) : null}
              </>
            )}
            <div className="wizard-footer">
              {editable && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void save()}
                >
                  {busy ? "Сохраняем…" : "Сохранить черновик"}
                </button>
              )}
              {step < 2 ? (
                <button
                  className="button primary"
                  onClick={() => setStep(step + 1)}
                >
                  Далее
                  <ArrowRight size={16} />
                </button>
              ) : (
                editable &&
                (draft?.status === "approved" && !dirty ? (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void publish()}
                  >
                    {busy ? "Размещаем в Devnet…" : "Разместить в Devnet"}
                  </button>
                ) : (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void approve()}
                  >
                    Проверить и утвердить
                  </button>
                ))
              )}
              {draft?.issueId && (
                <button
                  className="button primary"
                  onClick={() => {
                    setEditing(false);
                    onSelect(draft.issueId!);
                  }}
                >
                  Открыть выпуск
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
            {busy && (
              <p role="status" className="muted">
                Дождитесь завершения. Размещение требует нескольких
                подтверждённых транзакций.
              </p>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
