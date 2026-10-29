// Nepal time (UTC+5:45) for date/time inputs, plus small formatters.
const NPT_MS = (5 * 60 + 45) * 60_000;
export const DAY = 86_400_000;

/** ISO (UTC) -> value for <input type="datetime-local"> in Nepal time. */
export const isoToInput = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + NPT_MS).toISOString().slice(0, 16) : "");
/** <input type="datetime-local"> value read as Nepal time -> ISO (UTC). */
export const inputToIso = (v: string) => (v ? new Date(Date.parse(v + ":00Z") - NPT_MS).toISOString() : null);
/** A production day (06:00 start) as YYYY-MM-DD in Nepal time. */
export const dayLabel = (d: Date) => new Date(d.getTime() + NPT_MS - 6 * 3_600_000).toISOString().slice(0, 10);
/** 06:00 Nepal time of a YYYY-MM-DD day. */
export const dayStartOf = (ymd: string) => new Date(Date.parse(ymd + "T06:00:00Z") - NPT_MS);

export const kgFmt = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
export const tonFmt = (kg: number) => (kg / 1000).toLocaleString("en-US", { maximumFractionDigits: 1 });
export const hoursFmt = (ms: number) => `${(ms / 3_600_000).toFixed(1)} h`;

export const cls = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");
