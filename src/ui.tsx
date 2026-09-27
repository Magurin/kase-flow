import { useEffect, useRef, type ReactNode } from "react";
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
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  const isLocked = useRef(locked);
  close.current = onClose;
  isLocked.current = locked;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () =>
      Array.from(
        dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    (focusable()[0] ?? dialog.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (
        e.defaultPrevented ||
        (e.target instanceof Element && e.target.closest('[role="listbox"]'))
      )
        return;
      if (e.key === "Escape" && !isLocked.current) {
        e.preventDefault();
        close.current();
      }
      if (e.key !== "Tab") return;
      const nodes = focusable();
      if (!nodes.length) {
        e.preventDefault();
        dialog.current?.focus();
        return;
      }
      const first = nodes[0],
        last = nodes[nodes.length - 1];
      if (
        e.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === dialog.current)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  return (
    <div className="overlay" onClick={() => !locked && onClose()}>
      <section
        ref={dialog}
        tabIndex={-1}
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
    <path
      d="M8 22V16M13 22V12M18 22V9"
      stroke="#fff"
      strokeWidth="3"
      strokeLinecap="round"
    />
    <path
      d="m20.5 18 2.5 2.5 4-5"
      stroke="#9BE0A8"
      strokeWidth="2.4"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
