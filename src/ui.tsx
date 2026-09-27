import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { STATUS, STATUS_TONE } from "./domain";

export function Dialog({
  title,
  subtitle,
  onClose,
  locked = false,
  wide = false,
  footer,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose(): void;
  locked?: boolean;
  wide?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && !locked && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [locked, onClose]);
  return (
    <div className="overlay" onClick={() => !locked && onClose()}>
      <section
        className={`dialog ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dialog-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            className="dialog-close"
            aria-label="Закрыть"
            disabled={locked}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="dialog-body">{children}</div>
        {footer && <footer className="dialog-foot">{footer}</footer>}
      </section>
    </div>
  );
}

export const Status = ({ status }: { status: number }) => (
  <span className={`badge ${STATUS_TONE[status]}`}>{STATUS[status]}</span>
);

export function Kpi({
  label,
  value,
  unit,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  note?: ReactNode;
  tone?: "good" | "bad";
}) {
  return (
    <div className={`kpi ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>
        {value}
        {unit && <small>{unit}</small>}
      </strong>
      {note && <em>{note}</em>}
    </div>
  );
}

export function PanelHead({
  title,
  count,
  sub,
  children,
}: {
  title: ReactNode;
  count?: number;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="panel-head">
      <div>
        <h2>
          {title}
          {count !== undefined && <span className="count">{count}</span>}
        </h2>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="panel-tools">{children}</div>}
    </div>
  );
}

export function Empty({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      {icon}
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** The KASE Flow mark: a green bar chart rising into a settled tick. */
export const Mark = () => (
  <svg className="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="4" fill="#028A29" />
    <path d="M8 22V16M13 22V12M18 22V9" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
    <path d="m20.5 18 2.5 2.5 4-5" stroke="#9BE0A8" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
