import { ArrowUpRight, Download, FileText } from "lucide-react";
import type { Ctx } from "../ctx";
import { JOURNAL, symbolOf } from "../domain";
import { isoTime, short } from "../format";
import { Empty, PanelHead } from "../ui";
import { explorer } from "../api";

export function Journal(c: Ctx) {
  const { s } = c;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="crumbs">
            <b>{symbolOf(s)}</b> · журнал
          </div>
          <h1>Журнал операций</h1>
          <p className="page-sub">
            Каждая запись - подтверждённая транзакция Solana. Откройте строку,
            чтобы проверить журнал программы через RPC.
          </p>
        </div>
        <div className="page-actions">
          <a
            className="btn btn-secondary"
            href={`/api/export?issue=${encodeURIComponent(s.config.state)}`}
            download
          >
            <Download size={16} />
            Аудит выпуска, JSON
          </a>
        </div>
      </div>
      <section className="panel">
        <dl className="kv">
          {[
            ["Аккаунт выпуска", s.config.state],
            ["Программа", s.config.programId],
            ["Mint облигации", s.tokens?.bondMint],
            ["Escrow", s.tokens?.vault],
          ]
            .filter(([, v]) => v)
            .map(([label, v]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  <a
                    href={explorer("address", v!)}
                    target="_blank"
                    rel="noreferrer"
                    className="mono"
                  >
                    {short(v!)} <ArrowUpRight size={12} />
                  </a>
                </dd>
              </div>
            ))}
        </dl>
      </section>
      <section className="panel">
        <PanelHead title="Транзакции" count={s.journal.length} />
        {s.journalStale && (
          <div className="notice warn">
            История RPC временно недоступна. Показаны сохранённые подтверждённые
            операции.
          </div>
        )}
        {s.journal.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Время</th>
                  <th>Операция</th>
                  <th>Подпись</th>
                  <th>Статус</th>
                  <th className="num">Explorer</th>
                </tr>
              </thead>
              <tbody>
                {s.journal.map((j) => (
                  <tr
                    key={j.signature}
                    className="clickable"
                    onClick={() => c.inspect(j.signature)}
                  >
                    <td style={{ whiteSpace: "nowrap" }}>{isoTime(j.time)}</td>
                    <td>{JOURNAL[j.type] ?? j.label ?? j.type}</td>
                    <td className="mono">
                      <button
                        className="btn btn-ghost"
                        aria-label={`Открыть транзакцию ${j.signature}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          c.inspect(j.signature);
                        }}
                      >
                        {short(j.signature)}
                      </button>
                    </td>
                    <td>
                      <span className="badge ok">Подтверждена</span>
                    </td>
                    <td className="num">
                      <a
                        href={explorer("tx", j.signature)}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Открыть в Solana Explorer"
                      >
                        <ArrowUpRight size={15} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty icon={<FileText size={30} />} title="Записей пока нет" />
        )}
      </section>
    </div>
  );
}
