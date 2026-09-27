import { useEffect, useRef, useState } from "react";
import { getJson } from "../http";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  FileCheck2,
  Landmark,
  Plus,
  Search,
  X,
} from "lucide-react";
import { CustomSelect } from "../CustomSelect";
import { Dialog, Empty, Kpi, PanelHead } from "../ui";
import { dateTime, money, tenor, units } from "../format";
import { explorer, post } from "../api";

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
  timeMode?: "demo" | "calendar";
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
  updatedAt?: string;
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
  statsStale?: boolean;
};

const YEAR = 31_536_000;
const fresh = (): Terms => ({
  issuer: "",
  name: "",
  symbol: "",
  face: "1000",
  couponBps: 1000,
  frequency: 2,
  periods: 4,
  timeMode: "demo",
  duration: 600,
  supply: 1000,
  document: "",
  applications: [
    { name: "Alatau Capital", wallet: "", units: 400, admitted: false },
    { name: "Steppe Ventures", wallet: "", units: 300, admitted: false },
    { name: "Aida S.", wallet: "", units: 200, admitted: false },
    { name: "Timur K.", wallet: "", units: 100, admitted: false },
  ],
});
const DRAFT_STATUS: Record<string, [string, string]> = {
  draft: ["Черновик", ""],
  approved: ["Утверждён", "info"],
  publishing: ["Размещается", "info"],
  published: ["Размещён", "ok"],
  needs_review: ["Требует проверки", "bad"],
};

export function Issues({
  activeId,
  onSelect,
  readOnly = false,
}: {
  activeId: string;
  onSelect(id: string): void;
  readOnly?: boolean;
}) {
  const [issues, setIssues] = useState<Issue[]>([]),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [editing, setEditing] = useState<Draft | "new" | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [search, setSearch] = useState("");
  const request = useRef<AbortController | null>(null);
  async function refresh() {
    if (request.current && !request.current.signal.aborted) return;
    const controller = new AbortController();
    request.current = controller;
    try {
      const data = await getJson("/api/workspace", controller.signal);
      if (controller.signal.aborted) return;
      setIssues(data.issues);
      setDrafts(data.drafts);
      setError("");
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (request.current === controller) request.current = null;
    }
  }
  useEffect(() => {
    void refresh();
    const t = setInterval(
      () => {
        if (!document.hidden) void refresh();
      },
      readOnly ? 30000 : 10000,
    );
    return () => {
      clearInterval(t);
      request.current?.abort();
    };
  }, []);
  const shown = issues.filter((i) =>
    `${i.name} ${i.symbol} ${i.issuer}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const openDrafts = drafts.filter((d) => d.status !== "published");
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            <b>KASE Flow</b> · {readOnly ? "публичные выпуски" : "эмитент"}
          </div>
          <h1>Выпуски</h1>
          <p className="page-sub">
            {readOnly
              ? "Реальные тестовые выпуски в Solana Devnet: реестры, начисления и результаты операций."
              : "Каталог размещённых облигаций и подготовка новых выпусков в Solana Devnet."}
          </p>
        </div>
        <div className="page-actions">
          {!readOnly && (
            <button
              className="btn btn-primary"
              onClick={() => setEditing("new")}
            >
              <Plus size={16} />
              Новый выпуск
            </button>
          )}
        </div>
      </div>
      {error && !editing && (
        <div className="notice bad">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}
      <div className="kpis">
        <Kpi label="Размещено выпусков" value={issues.length} />
        <Kpi
          label="В обращении"
          value={issues.filter((i) => i.stats && i.stats.supply !== "0").length}
        />
        <Kpi
          label="Погашено"
          value={issues.filter((i) => i.stats?.supply === "0").length}
        />
        <Kpi
          label="В подготовке"
          value={
            drafts.filter((d) => ["draft", "approved"].includes(d.status))
              .length
          }
        />
        <Kpi
          label="Требуют проверки"
          value={drafts.filter((d) => d.status === "needs_review").length}
          tone={
            drafts.some((d) => d.status === "needs_review") ? "bad" : undefined
          }
        />
      </div>

      <section className="panel">
        <PanelHead title="Каталог выпусков" count={issues.length}>
          <label className="search">
            <Search size={14} />
            <input
              aria-label="Поиск выпусков"
              placeholder="Тикер, выпуск или эмитент"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </PanelHead>
        {shown.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Тикер</th>
                  <th>Выпуск</th>
                  <th>Статус</th>
                  <th className="num">В обращении</th>
                  <th className="num">Выплачено, TEST USD</th>
                  <th className="num">Escrow, TEST USD</th>
                  <th>Погашение</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => {
                  const redeemed = i.stats?.supply === "0";
                  return (
                    <tr
                      key={i.id}
                      className={`clickable ${i.id === activeId ? "selected" : ""}`}
                      onClick={() => onSelect(i.id)}
                    >
                      <td>
                        <span className="ticker-code">{i.symbol}</span>
                      </td>
                      <td>
                        {i.name}
                        <span className="sub">{i.issuer}</span>
                        <span className="sub mono">
                          {i.id.slice(0, 6)}…{i.id.slice(-4)}
                        </span>
                        {i.statsStale && (
                          <span className="badge warn">
                            Последние известные данные
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${redeemed ? "" : "ok"}`}>
                          {!i.stats
                            ? "Нет данных"
                            : redeemed
                              ? "Погашен"
                              : "В обращении"}
                        </span>
                      </td>
                      <td className="num">
                        {i.stats ? units(i.stats.supply) : "-"}
                      </td>
                      <td className="num">
                        {i.stats ? money(i.stats.paid) : "-"}
                      </td>
                      <td className="num">
                        {i.stats ? money(i.stats.escrow) : "-"}
                      </td>
                      <td className="nowrap">
                        {i.stats ? dateTime(i.stats.maturity) : "-"}
                      </td>
                      <td className="num">
                        <button
                          className="btn btn-sm btn-secondary"
                          aria-label={`Открыть выпуск ${i.id}`}
                        >
                          {i.id === activeId ? "Текущий" : "Открыть"}
                          <ArrowRight size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            icon={<Landmark size={28} />}
            title={
              loading
                ? "Загружаем выпуски…"
                : error
                  ? "Каталог временно недоступен"
                  : issues.length
                    ? "Ничего не найдено"
                    : "Выпусков пока нет"
            }
          />
        )}
        <div className="panel-foot">
          <span>
            {readOnly
              ? "Каталог сверяется с Devnet каждые 30 секунд. При недоступности сети сохранённые значения отмечены отдельно."
              : "Цифры обновляются при открытии выпуска: это последние прочитанные из сети значения."}
          </span>
        </div>
      </section>

      {!readOnly && (
        <section className="panel">
          <PanelHead
            title="Подготовка и согласование"
            count={openDrafts.length}
            sub="Версии условий сохраняются; после размещения условия неизменяемы"
          />
          {openDrafts.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Тикер</th>
                    <th>Выпуск</th>
                    <th className="num">Объём</th>
                    <th className="num">Купон</th>
                    <th>Версия</th>
                    <th>Статус</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {openDrafts.map((d) => {
                    const [label, tone] = DRAFT_STATUS[d.status] ?? [
                      d.status,
                      "",
                    ];
                    return (
                      <tr
                        key={d.id}
                        className="clickable"
                        onClick={() => setEditing(d)}
                      >
                        <td>
                          <span className="ticker-code">
                            {d.terms.symbol || "-"}
                          </span>
                        </td>
                        <td>
                          {d.terms.name || "Без названия"}
                          <span className="sub">{d.terms.issuer}</span>
                        </td>
                        <td className="num">{units(d.terms.supply)}</td>
                        <td className="num">
                          {(d.terms.couponBps / 100).toLocaleString("ru-RU")}%
                        </td>
                        <td>{d.revision}</td>
                        <td>
                          <span className={`badge ${tone}`}>{label}</span>
                        </td>
                        <td className="num">
                          <FileCheck2 size={16} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="panel-body hint">
              Черновиков нет. Условия и реестр можно подготовить заранее.
            </p>
          )}
        </section>
      )}

      {editing && (
        <IssueWizard
          draft={editing === "new" ? null : editing}
          onClose={() => {
            setEditing(null);
            void refresh();
          }}
          onPublished={(id) => {
            setEditing(null);
            onSelect(id);
          }}
        />
      )}
    </div>
  );
}

function IssueWizard({
  draft: initial,
  onClose,
  onPublished,
}: {
  draft: Draft | null;
  onClose(): void;
  onPublished(id: string): void;
}) {
  const [draft, setDraft] = useState<Draft | null>(initial),
    [terms, setTerms] = useState<Terms>(() => {
      const t = initial ? structuredClone(initial.terms) : fresh();
      // Drafts saved before time modes existed: long terms were real time.
      t.timeMode ??= t.duration > 86400 ? "calendar" : "demo";
      if (t.timeMode === "demo" && t.duration > 86400) t.duration = 600;
      return t;
    }),
    [step, setStep] = useState(initial ? 2 : 0),
    [dirty, setDirty] = useState(!initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const change = (patch: Partial<Terms>) => {
    setTerms({ ...terms, ...patch });
    setDirty(true);
    setError("");
  };
  const setApp = (i: number, patch: Partial<Application>) =>
    change({
      applications: terms.applications.map((a, j) =>
        j === i ? { ...a, ...patch } : a,
      ),
    });
  const allocated = terms.applications.reduce(
    (n, a) => n + (Number.isFinite(a.units) ? a.units : 0),
    0,
  );
  const periods =
    Number.isSafeInteger(terms.periods) && terms.periods > 0
      ? terms.periods
      : 0;
  // Matches server escrowBudget: one micro-unit per holder per period for rounding.
  const reserve = BigInt(terms.applications.length * periods);
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
      onPublished(result.issueId);
    } catch (e) {
      setError((e as Error).message);
      try {
        const v = await getJson("/api/workspace");
        const updated = v.drafts?.find((d: Draft) => d.id === draft.id);
        if (updated) setDraft(updated);
      } catch {
        /* Keep the original failure visible if reconciliation is unavailable. */
      }
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
      onPublished(v.issueId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const editable = !draft || ["draft", "approved"].includes(draft.status);
  const status = draft ? DRAFT_STATUS[draft.status]?.[0] : null;
  const checks: [string, boolean][] = [
    [
      `Распределено ${units(allocated)} из ${units(terms.supply)} облигаций`,
      allocated === terms.supply,
    ],
    [
      `Допуск подтверждён: ${terms.applications.filter((a) => a.admitted).length} из ${terms.applications.length}`,
      terms.applications.every((a) => a.admitted),
    ],
    [
      "Эмитент, название и тикер заполнены",
      !!(terms.issuer && terms.name && terms.symbol),
    ],
  ];
  return (
    <Dialog
      wide
      title={terms.name || "Новый выпуск"}
      subtitle={
        draft
          ? `Версия ${draft.revision} · ${status}`
          : "Черновик ещё не сохранён"
      }
      onClose={onClose}
      locked={busy}
      footer={
        <>
          {editable && (
            <button
              className="btn btn-secondary spacer"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Сохраняем…" : "Сохранить черновик"}
            </button>
          )}
          {step > 0 && (
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => setStep(step - 1)}
            >
              Назад
            </button>
          )}
          {step < 2 ? (
            <button
              className="btn btn-primary"
              onClick={() => setStep(step + 1)}
            >
              Далее <ArrowRight size={16} />
            </button>
          ) : draft?.issueId ? (
            <button
              className="btn btn-primary"
              onClick={() => onPublished(draft.issueId!)}
            >
              Открыть выпуск <ArrowRight size={16} />
            </button>
          ) : (
            editable &&
            (draft?.status === "approved" && !dirty ? (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void publish()}
              >
                {busy ? "Размещаем в Devnet…" : "Разместить в Devnet"}
              </button>
            ) : (
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void approve()}
              >
                Проверить и утвердить
              </button>
            ))
          )}
        </>
      }
    >
      <div className="tabs">
        {["Условия", "Инвесторы", "Проверка"].map((n, i) => (
          <button
            key={n}
            className={step === i ? "active" : ""}
            onClick={() => setStep(i)}
          >
            <span className="n">{i + 1}</span>
            {n}
          </button>
        ))}
      </div>
      {error && (
        <div className="notice bad">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}
      {draft?.status === "needs_review" && (
        <div className="notice bad">
          <AlertTriangle size={16} />
          <span className="grow">
            <b>{draft.error}</b> Автоматический повтор отключён, чтобы исключить
            повторное размещение.
            <br />
            {draft.provisioning && (
              <a
                target="_blank"
                rel="noreferrer"
                href={explorer("address", draft.provisioning.config.state)}
              >
                Аккаунт в Explorer <ExternalLink size={12} />
              </a>
            )}{" "}
            <button
              className="btn btn-sm btn-secondary"
              disabled={busy}
              onClick={() => void reconcile()}
            >
              Сверить с сетью
            </button>
          </span>
        </div>
      )}
      <fieldset
        disabled={busy || !editable}
        style={{ display: "grid", gap: 16 }}
      >
        {step === 0 && (
          <>
            <div className="form-grid">
              <label className="field">
                Эмитент
                <input
                  value={terms.issuer}
                  onChange={(e) => change({ issuer: e.target.value })}
                  placeholder="ТОО «Компания»"
                />
              </label>
              <label className="field">
                Название выпуска
                <input
                  value={terms.name}
                  onChange={(e) => change({ name: e.target.value })}
                  placeholder="Облигации, серия 01"
                />
              </label>
              <label className="field">
                Тикер
                <input
                  value={terms.symbol}
                  onChange={(e) =>
                    change({ symbol: e.target.value.toUpperCase() })
                  }
                  placeholder="ENRG.01"
                  maxLength={16}
                />
              </label>
              <label className="field">
                Номинал, TEST USD
                <input
                  inputMode="decimal"
                  value={terms.face}
                  onChange={(e) => change({ face: e.target.value })}
                />
              </label>
              <label className="field">
                Объём, облигаций
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  value={terms.supply}
                  onChange={(e) => change({ supply: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                Годовая ставка купона, %
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
              <label className="field">
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
              <label className="field">
                Купонных периодов
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={terms.periods}
                  onChange={(e) => change({ periods: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                Режим времени
                <CustomSelect
                  label="Режим времени"
                  value={terms.timeMode === "calendar" ? 1 : 0}
                  onChange={(mode) =>
                    change(
                      mode
                        ? { timeMode: "calendar" }
                        : { timeMode: "demo", duration: 600 },
                    )
                  }
                  options={[
                    { value: 0, label: "Демо: сжатое время" },
                    { value: 1, label: "Реальный календарь" },
                  ]}
                  disabled={busy || !editable}
                />
              </label>
              {terms.timeMode !== "calendar" && (
                <label className="field">
                  Длительность демо
                  <CustomSelect
                    label="Длительность демо"
                    value={terms.duration}
                    onChange={(duration) => change({ duration })}
                    options={[
                      { value: 300, label: "5 минут" },
                      { value: 600, label: "10 минут" },
                      { value: 3600, label: "1 час" },
                      { value: 86400, label: "1 день" },
                    ]}
                    disabled={busy || !editable}
                  />
                </label>
              )}
            </div>
            <div className="notice info">
              <Landmark size={16} />
              <span>
                Номинальный срок{" "}
                <b>
                  {terms.periods > 0 && terms.frequency > 0
                    ? tenor(terms.periods, terms.frequency)
                    : "-"}
                </b>
                : {terms.periods} купонов по {terms.frequency} в год.{" "}
                {terms.timeMode === "calendar"
                  ? `Выпуск живёт в Devnet ${Math.round((terms.periods * YEAR) / terms.frequency / 86400)} дней, даты купонов реальные.`
                  : "В демо срок сжат в выбранную длительность, суммы купонов те же, что при реальном сроке."}
              </span>
            </div>
            <label className="field">
              Условия и документы
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
            <div
              className={`notice ${allocated === terms.supply ? "ok" : "warn"}`}
            >
              {allocated === terms.supply ? (
                <Check size={16} />
              ) : (
                <AlertTriangle size={16} />
              )}
              <span>
                Распределено <b>{units(allocated)}</b> из{" "}
                <b>{units(terms.supply)}</b> облигаций. Допуск подтверждает
                оператор; внешняя KYC-проверка не подключена.
              </span>
            </div>
            <div className="panel">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Инвестор</th>
                      <th>Кошелёк Solana</th>
                      <th className="num">Облигаций</th>
                      <th>Допуск</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {terms.applications.map((a, i) => (
                      <tr key={i}>
                        <td className="cell-input">
                          <input
                            value={a.name}
                            aria-label={`Инвестор ${i + 1}`}
                            onChange={(e) =>
                              setApp(i, { name: e.target.value })
                            }
                          />
                        </td>
                        <td className="cell-input">
                          <input
                            value={a.wallet}
                            aria-label={`Кошелёк инвестора ${i + 1}`}
                            placeholder="пусто: тестовый кошелёк"
                            onChange={(e) =>
                              setApp(i, { wallet: e.target.value })
                            }
                          />
                        </td>
                        <td className="cell-input" style={{ width: 120 }}>
                          <input
                            type="number"
                            min={1}
                            aria-label={`Облигаций инвестора ${i + 1}`}
                            value={a.units}
                            onChange={(e) =>
                              setApp(i, { units: Number(e.target.value) })
                            }
                          />
                        </td>
                        <td>
                          <label className="check">
                            <input
                              type="checkbox"
                              checked={a.admitted}
                              onChange={(e) =>
                                setApp(i, { admitted: e.target.checked })
                              }
                            />
                            Допущен
                          </label>
                        </td>
                        <td className="num">
                          <button
                            className="btn btn-quiet-danger"
                            aria-label="Убрать инвестора"
                            disabled={terms.applications.length === 1}
                            onClick={() =>
                              change({
                                applications: terms.applications.filter(
                                  (_, j) => i !== j,
                                ),
                              })
                            }
                          >
                            <X size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <button
                className="btn btn-secondary btn-sm"
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
                <Plus size={14} /> Добавить инвестора
              </button>{" "}
              <span className="hint">
                До 16 держателей. Облигации распределяются при размещении,
                оплата подписки не реализована.
              </span>
            </div>
          </>
        )}
      </fieldset>
      {step === 2 && (
        <>
          <div className="summary rows">
            <div>
              <span>Выпуск</span>
              <b>
                {terms.symbol || "-"} · {terms.issuer || "эмитент не указан"}
              </b>
            </div>
            <div>
              <span>Основной долг</span>
              <b>{money(principal)} TEST USD</b>
            </div>
            <div>
              <span>Каждый купон</span>
              <b>{money(coupon)} TEST USD</b>
            </div>
            <div>
              <span>Резерв на округление</span>
              <b>{money(reserve)} TEST USD</b>
            </div>
            <div>
              <span>Бюджет escrow</span>
              <b className="total">
                {money(principal + coupon * BigInt(periods) + reserve)} TEST USD
              </b>
            </div>
          </div>
          <div className="rows">
            {checks.map(([label, ok]) => (
              <div key={label}>
                <span>{label}</span>
                <b className={ok ? "up" : "down"}>
                  {ok ? <Check size={16} /> : <AlertTriangle size={16} />}
                </b>
              </div>
            ))}
          </div>
          <p className="hint">
            При размещении создаются облигации Token-2022 и escrow с полным
            бюджетом в TEST USD без обеспечения. Комиссии оплачиваются тестовыми
            SOL. После размещения условия неизменяемы.
          </p>
          {draft?.approval && !dirty && (
            <div className="notice ok">
              <Check size={16} />
              <span>
                Версия утверждена оператором (локальное согласование, не
                мультиподпись).
                <br />
                <code style={{ wordBreak: "break-all" }}>
                  {draft.approval.hash}
                </code>
              </span>
            </div>
          )}
          {draft?.history?.length ? (
            <details>
              <summary>История версий</summary>
              {draft.history.map((h, i) => (
                <p key={i}>
                  {h.event}
                  {h.revision ? ` · версия ${h.revision}` : ""}
                  {h.at ? ` · ${new Date(h.at).toLocaleString("ru-RU")}` : ""}
                </p>
              ))}
            </details>
          ) : null}
        </>
      )}
      {busy && (
        <p className="hint">
          Не закрывайте окно: размещение требует нескольких подтверждённых
          транзакций.
        </p>
      )}
    </Dialog>
  );
}
