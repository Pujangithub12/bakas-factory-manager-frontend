import { useState } from "react";
import NepaliDateModule from "nepali-date-converter";
import { addDays, fmtDayKey } from "../shared/time";

// The package's default export arrives wrapped once more under some loaders.
const NepaliDate: typeof NepaliDateModule = (NepaliDateModule as unknown as { default?: typeof NepaliDateModule }).default ?? NepaliDateModule;

/** How dates are shown: English (AD) or Nepali (Bikram Sambat). */
export type DateMode = "en" | "np";

const KEY = "attendance_date";
const read = (): DateMode => {
  // Nepali dates unless this computer has chosen English.
  try { return localStorage.getItem(KEY) === "en" ? "en" : "np"; } catch { return "np"; }
};

/** The chosen date style, remembered on this computer. */
export function useDateMode(): [DateMode, (m: DateMode) => void] {
  const [mode, setMode] = useState<DateMode>(read);
  // Saved only when someone picks, so the Nepali default holds until then.
  const choose = (m: DateMode) => {
    setMode(m);
    try { localStorage.setItem(KEY, m); } catch { /* private window */ }
  };
  return [mode, choose];
}

const NP_DIGITS = "०१२३४५६७८९";
export const npNum = (n: number | string) => String(n).replace(/[0-9]/g, (d) => NP_DIGITS[Number(d)]);

export const BS_MONTHS_NP = ["बैशाख", "जेठ", "असार", "साउन", "भदौ", "असोज", "कार्तिक", "मंसिर", "पुष", "माघ", "फागुन", "चैत"];
export const WEEK_NP = ["आइतबार", "सोमबार", "मंगलबार", "बुधबार", "बिहीबार", "शुक्रबार", "शनिबार"];
const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A day key (2026-11-27) as a Bikram Sambat date. Month is 0 for Baisakh. */
export function toBS(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  const bs = new NepaliDate(new Date(y, m - 1, d, 12)).getBS();
  return { y: bs.year, m: bs.month, d: bs.date };
}

/** A Bikram Sambat date as a day key. */
export function fromBS(y: number, m: number, d: number) {
  const ad = new NepaliDate(y, m, d).getAD();
  return `${ad.year}-${String(ad.month + 1).padStart(2, "0")}-${String(ad.date).padStart(2, "0")}`;
}

/** Every day of the month that `anchor` falls in, as day keys. */
export function periodDays(anchor: string, mode: DateMode) {
  const out: string[] = [];
  if (mode === "en") {
    const month = anchor.slice(0, 7);
    for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d);
    return out;
  }
  const { y, m } = toBS(anchor);
  for (let d = fromBS(y, m, 1); toBS(d).m === m; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "November 2026" or "मंसिर २०८३" for the month that `anchor` falls in. */
export function monthLabel(anchor: string, mode: DateMode) {
  if (mode === "en") return `${MONTHS_EN[Number(anchor.slice(5, 7)) - 1]} ${anchor.slice(0, 4)}`;
  const { y, m } = toBS(anchor);
  return `${BS_MONTHS_NP[m]} ${npNum(y)}`;
}

/** A month key for file names: 2026-11 or 2083-08 (Mangsir). */
export function monthKey(anchor: string, mode: DateMode) {
  if (mode === "en") return anchor.slice(0, 7);
  const { y, m } = toBS(anchor);
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** The day of the month to print in a calendar or column head. */
export const dayNum = (key: string, mode: DateMode) => (mode === "en" ? String(Number(key.slice(8))) : npNum(toBS(key).d));

/** A full date: the app's English style, or "११ मंसिर २०८३". */
export function fmtDay(key: string, mode: DateMode) {
  if (mode === "en") return fmtDayKey(key);
  const { y, m, d } = toBS(key);
  return `${npNum(d)} ${BS_MONTHS_NP[m]} ${npNum(y)}`;
}

/** A plain-digit Bikram Sambat date for spreadsheets: 2083-08-11. */
export function bsKey(key: string) {
  const { y, m, d } = toBS(key);
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
