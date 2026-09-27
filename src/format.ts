// Number and date formatting in the kase.kz convention: ru-RU grouping
// ("1 265,00"), two decimals for money, up to six when micro-units matter.
const amount = new Intl.NumberFormat("ru-RU", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});
const whole = new Intl.NumberFormat("ru-RU");

/** Micro-units of TEST USD as "1 200 000,00". */
export const money = (micro: string | bigint | number) =>
  amount.format(Number(micro) / 1e6);
export const units = (n: string | bigint | number) => whole.format(Number(n));
export const pct = (bps: number) =>
  new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(bps / 100) + "%";
export const short = (v: string) => `${v.slice(0, 4)}…${v.slice(-4)}`;
export const dateTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
export const time = (seconds: number) =>
  new Date(seconds * 1000).toLocaleTimeString("ru-RU");
export const isoTime = (iso: string) =>
  new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
/** Countdown such as "2 мин 05 с". */
export const span = (seconds: number) => {
  if (seconds <= 0) return "0 с";
  const d = Math.floor(seconds / 86400),
    h = Math.floor((seconds % 86400) / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = seconds % 60;
  if (d) return `${d} д ${h} ч`;
  if (h) return `${h} ч ${String(m).padStart(2, "0")} мин`;
  if (m) return `${m} мин ${String(s).padStart(2, "0")} с`;
  return `${s} с`;
};
/** Nominal tenor from coupon count and yearly frequency. */
export const tenor = (periods: number, frequency: number) => {
  const months = Math.round((periods * 12) / frequency);
  return months % 12 === 0 ? `${months / 12} г.` : `${months} мес.`;
};
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((v) => v[0]?.toUpperCase())
    .join("");
