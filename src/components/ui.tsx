import { useEffect, useState, type ReactNode } from "react";
import { cls } from "../lib/util";

export function Button({ children, onClick, kind = "primary", disabled, small, type = "button" }: {
  children: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "danger" | "soft"; disabled?: boolean; small?: boolean; type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cls(
        "rounded-lg font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap",
        small ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm",
        kind === "primary" && "bg-brand-700 text-white hover:bg-brand-800",
        kind === "danger" && "bg-red-700 text-white hover:bg-red-800",
        kind === "soft" && "bg-brand-100 text-brand-800 hover:bg-brand-200",
        kind === "ghost" && "border border-slate-300 text-slate-700 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

/** The brown logo tile with three bars, as on the phone sign-in. */
export const Logo = ({ size = 44 }: { size?: number }) => (
  <div className="flex shrink-0 items-center justify-center rounded-xl bg-brand-700" style={{ width: size, height: size }}>
    <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <rect x="3" y="9" width="4.5" height="12" rx="2.2" />
      <rect x="9.75" y="3" width="4.5" height="18" rx="2.2" />
      <rect x="16.5" y="12" width="4.5" height="9" rx="2.2" />
    </svg>
  </div>
);

/**
 * Number pad with dots for the 6-digit PIN. Works with the mouse and the keyboard. onComplete runs on the last
 * digit; if it returns a message it is shown and the PIN is cleared.
 */
export function PinPad({ length = 6, onComplete }: { length?: number; onComplete: (pin: string) => Promise<string | void> }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const press = async (d: string) => {
    if (busy || pin.length >= length) return;
    const next = pin + d;
    setError("");
    setPin(next);
    if (next.length < length) return;
    setBusy(true);
    try {
      const msg = await onComplete(next);
      if (msg) setError(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setPin("");
      setBusy(false);
    }
  };
  const back = () => { if (!busy) { setError(""); setPin((p) => p.slice(0, -1)); } };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const key = "flex h-[72px] flex-1 items-center justify-center rounded-2xl border border-[#e4e0d6] bg-card text-3xl font-semibold text-slate-900 transition hover:bg-brand-100 active:bg-brand-100 disabled:opacity-60";
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-5">
      <div className="flex h-6 items-center gap-4">
        {Array.from({ length }).map((_, i) => (
          <span key={i} className={cls("h-5 w-5 rounded-full border-2", error ? "border-red-600" : "border-slate-800", i < pin.length && (error ? "bg-red-600" : "bg-slate-800"))} />
        ))}
      </div>
      <p className="min-h-5 text-center text-sm font-semibold text-red-700">{error}</p>
      <div className="grid w-full grid-cols-3 gap-3">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button key={d} type="button" disabled={busy} onClick={() => press(d)} className={key}>{d}</button>)}
        <span />
        <button type="button" disabled={busy} onClick={() => press("0")} className={key}>0</button>
        <button type="button" disabled={busy} onClick={back} className={key} aria-label="Delete">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 5H9l-6 7 6 7h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" /><path d="m17 9-6 6M11 9l6 6" /></svg>
        </button>
      </div>
    </div>
  );
}

export const Card = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cls("rounded-2xl border border-[#d9d5cc] bg-card p-4 shadow-sm", className)}>{children}</div>
);

const tones = {
  good: "bg-emerald-50 text-emerald-800", bad: "bg-red-50 text-red-700", warn: "bg-amber-50 text-amber-800",
  info: "bg-blue-50 text-blue-800", mute: "bg-slate-100 text-slate-600",
};
export const Badge = ({ children, tone = "mute" }: { children: ReactNode; tone?: keyof typeof tones }) => (
  <span className={cls("inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone])}>{children}</span>
);

export const PageHeader = ({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) => (
  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
    <div>
      <h1 className="font-bold text-slate-900">{title}</h1>
      {sub ? <p className="text-sm text-slate-500">{sub}</p> : null}
    </div>
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </div>
);

export const Label = ({ children }: { children: ReactNode }) => <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">{children}</span>;

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600";

export function Field({ label, value, onChange, type = "text", placeholder, hint, disabled }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; hint?: string; disabled?: boolean;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input className={input} type={type} value={value} placeholder={placeholder} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
      {hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea className={input} rows={2} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function Select({ label, value, onChange, options, placeholder = "Choose" }: {
  label?: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string;
}) {
  const el = (
    <select className={input} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return label ? <label className="block"><Label>{label}</Label>{el}</label> : el;
}

export function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onMouseDown={onClose}>
      <div className={cls("my-8 w-full rounded-2xl bg-white p-6 shadow-xl", wide ? "max-w-3xl" : "max-w-lg")} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  const rows = Array.isArray(children) ? children.length : children ? 1 : 0;
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>{head.map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {rows === 0 ? <p className="p-6 text-center text-sm text-slate-500">{empty ?? "Nothing to show."}</p> : null}
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cls("px-3 py-2 align-middle", className)}>{children}</td>;

/** Run an async action, show its error, and refresh. */
export function useRun(after?: () => void | Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await after?.();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

export const ErrorText = ({ text }: { text: string | null }) => (text ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{text}</p> : null);
