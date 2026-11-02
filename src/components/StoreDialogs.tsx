// The four store dialogs of the laptop Store page (issue, return, receive, item). Also used from Purchase requests (receive).
import { useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/data";
import { newId, push } from "../lib/api";
import { Button, ErrorText, Field, Label, Modal, Select, useRun } from "./ui";
import { inputToIso, isoToInput } from "../lib/util";
import { KINDS, freeQty, itemName, num, onSiteMap, personName, prText, rolesOf, round2 } from "../shared/rules";
import { HOUR, nowIso, shiftWindow, fmtTime, type Row } from "../shared/time";

export const qty = (n: unknown) => num(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
export const decimal = (v: string) => v.replace(/[^\d.]/g, "");

/** Radio choices with a small second line, as in the prototype. */
export function Radios({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string; sub?: string }[] }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm ${value === o.value ? "border-brand-600 bg-brand-100" : "border-slate-300 bg-white"}`}>
            <input type="radio" className="mt-1 accent-brand-700" checked={value === o.value} onChange={() => onChange(o.value)} />
            <span><span className="font-semibold text-slate-900">{o.label}</span>{o.sub ? <span className="block text-xs text-slate-500">{o.sub}</span> : null}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function Footer({ error, busy, label, onClose, onSubmit, kind }: { error: string | null; busy: boolean; label: string; onClose: () => void; onSubmit: () => void; kind?: "primary" | "danger" }) {
  return (
    <div className="mt-4 space-y-3">
      <ErrorText text={error} />
      <div className="flex justify-end gap-2">
        <Button kind="ghost" onClick={onClose}>Cancel</Button>
        <Button kind={kind} disabled={busy} onClick={onSubmit}>{label}</Button>
      </div>
    </div>
  );
}

export const Sub = ({ children }: { children: ReactNode }) => <p className="mb-3 text-sm text-slate-500">{children}</p>;

export function IssueDialog({ itemId, onClose }: { itemId?: string; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const it0 = itemId ? D.store_item.find((i) => i.id === itemId) : undefined;
  const [item, setItem] = useState(itemId ?? "");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("1");
  const [job, setJob] = useState("");
  const [due, setDue] = useState(() => isoToInput((shiftWindow(D.shift)?.end ?? new Date(Date.now() + 8 * HOUR)).toISOString()));
  const [note, setNote] = useState("");
  const { busy, error, run } = useRun(reload);

  const site = onSiteMap(D);
  const people = D.person.filter((p) => p.active && site.has(p.id) && !rolesOf(D, p.id).some((r) => r === "Security" || r === "Owner"));
  const jobs = D.maintenance_job.filter((j) => !j.fixed_at);
  const tag = (j: Row) => D.machine.find((m) => m.id === j.machine_id)?.tag;

  const submit = async () => {
    if (await run(async () => {
      const it = D.store_item.find((i) => i.id === item);
      if (!it) throw new Error("Choose the item.");
      if (!to) throw new Error("Choose who takes it.");
      const n = Number(q);
      if (!(n > 0)) throw new Error("Enter the quantity.");
      const free = freeQty(D, it);
      if (n > free) throw new Error(`Only ${qty(free)} ${it.unit} available.`);
      const tool = it.kind === "Tool";
      const j = jobs.find((x) => x.id === job);
      const text = [j ? `${tag(j)}: ${j.problem}` : "", note.trim()].filter(Boolean).join(" · ");
      const shiftEnd = (shiftWindow(D.shift)?.end ?? new Date(Date.now() + 8 * HOUR)).toISOString();
      await push([
        { table: "store_movement", data: { id: newId(), item_id: it.id, type: "issue", qty: n, to_person_id: to, by: session!.person.id, at: nowIso(), due_back: tool ? inputToIso(due) ?? shiftEnd : null, returned_at: null, condition: null, returned_by: null, note: text || null, job_id: job || null, task_id: null, pr_id: null } },
        ...(tool ? [] : [{ table: "store_item", data: { id: it.id, qty: round2(num(it.qty) - n) } }]),
      ]);
    })) onClose();
  };

  return (
    <Modal title="Issue from the store" onClose={onClose} wide>
      <Sub>{it0 ? it0.name : "Tools go out to a person and must come back."}</Sub>
      <div className="grid gap-3 md:grid-cols-2">
        {it0 ? null : (
          <div className="md:col-span-2">
            <Select label="Item" value={item} onChange={setItem} options={[...D.store_item].sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ value: i.id, label: `${i.name} (${i.kind === "Tool" ? `${qty(freeQty(D, i))} free` : `${qty(i.qty)} ${i.unit}`})` }))} />
          </div>
        )}
        <Select label="To" value={to} onChange={setTo} placeholder="Choose a person on site" options={people.map((p) => ({ value: p.id, label: `${p.full_name} · ${rolesOf(D, p.id).join(", ")}` }))} />
        <Field label="Quantity" value={q} onChange={(v) => setQ(decimal(v))} />
        <div className="md:col-span-2">
          <Select label="For (optional)" value={job} onChange={setJob} placeholder="-" options={jobs.map((j) => ({ value: j.id, label: `${tag(j)}: ${j.problem}` }))} />
        </div>
        <Field label="Bring back by (tools)" type="datetime-local" value={due} onChange={setDue} />
        <Field label="Note" value={note} onChange={setNote} />
      </div>
      <Footer error={error} busy={busy} label="Issue" onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}

export function ReturnDialog({ move, onClose }: { move: Row; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const [cond, setCond] = useState("OK");
  const [note, setNote] = useState("");
  const { busy, error, run } = useRun(reload);
  const it = D.store_item.find((i) => i.id === move.item_id);

  const submit = async () => {
    if (await run(async () => {
      if (cond !== "OK" && !note.trim()) throw new Error("Say what is wrong.");
      await push([
        { table: "store_movement", data: { id: move.id, returned_at: nowIso(), condition: cond, returned_by: session!.person.id, note: [move.note, note.trim()].filter(Boolean).join(" · ") || null } },
        ...(cond === "Missing" && it ? [{ table: "store_item", data: { id: it.id, qty: Math.max(0, round2(num(it.qty) - num(move.qty))) } }] : []),
      ]);
    })) onClose();
  };

  return (
    <Modal title={`Return: ${itemName(D, move.item_id)}`} onClose={onClose}>
      <Sub>From {personName(D, move.to_person_id)} · out since {fmtTime(move.at)}</Sub>
      <div className="space-y-3">
        <Radios label="Checked on return" value={cond} onChange={setCond} options={[{ value: "OK", label: "OK", sub: "Working, clean" }, { value: "Damaged", label: "Damaged", sub: "Needs repair or replacing" }, { value: "Missing", label: "Missing", sub: "Not brought back" }]} />
        <Field label="Note" value={note} onChange={setNote} placeholder="What is wrong, if anything" />
      </div>
      <Footer error={error} busy={busy} label="Save return" onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}

/** Receive stock. With prId (Mark received on a request) the item and quantity of the request's first store line are filled in. */
export function ReceiveDialog({ itemId, prId: pre, onClose }: { itemId?: string; prId?: string; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const line = pre ? D.purchase_request_line.find((l) => l.pr_id === pre && l.item_id) : undefined;
  const [item, setItem] = useState(itemId ?? line?.item_id ?? "");
  const [q, setQ] = useState(line ? String(num(line.qty)) : "");
  const [prId, setPrId] = useState(pre ?? "");
  const [note, setNote] = useState("");
  const { busy, error, run } = useRun(reload);
  const it0 = itemId ? D.store_item.find((i) => i.id === itemId) : undefined;
  const open = D.purchase_request.filter((p) => p.status === "Approved" || p.status === "Ordered");

  const submit = async () => {
    if (await run(async () => {
      const it = D.store_item.find((i) => i.id === item);
      const n = Number(q);
      if (!it) throw new Error("Choose the item.");
      if (!(n > 0)) throw new Error("Enter the quantity.");
      const now = nowIso();
      const me = session!.person.id;
      await push([
        { table: "store_item", data: { id: it.id, qty: round2(num(it.qty) + n) } },
        { table: "store_movement", data: { id: newId(), item_id: it.id, type: "in", qty: n, to_person_id: null, by: me, at: now, due_back: null, returned_at: null, condition: null, returned_by: null, note: note.trim() || null, job_id: null, task_id: null, pr_id: prId || null } },
        ...(prId ? [{ table: "purchase_request", data: { id: prId, status: "Received", received_by: me, received_at: now } }] : []),
      ]);
    })) onClose();
  };

  return (
    <Modal title="Receive stock" onClose={onClose}>
      {it0 ? <Sub>{it0.name}</Sub> : null}
      <div className="space-y-3">
        {it0 ? null : <Select label="Item" value={item} onChange={setItem} options={[...D.store_item].sort((a, b) => a.name.localeCompare(b.name)).map((i) => ({ value: i.id, label: i.name }))} />}
        <Field label="Quantity" value={q} onChange={(v) => setQ(decimal(v))} />
        <Select label="Against purchase request" value={prId} onChange={setPrId} placeholder="None" options={open.map((p) => ({ value: p.id, label: `${p.pr_no} · ${prText(D, p)}` }))} />
        <Field label="Note" value={note} onChange={setNote} placeholder="Supplier, bill no." />
      </div>
      <Footer error={error} busy={busy} label="Receive" onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}

/** New store item, or edit one. The rate is the Owner's. */
export function ItemDialog({ itemId, onClose }: { itemId?: string; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const owner = session!.roles.includes("Owner");
  const it = itemId ? D.store_item.find((i) => i.id === itemId) : undefined;
  const [f, setF] = useState({
    name: it?.name ?? "", kind: it?.kind ?? "Spare", code: it?.code ?? "", unit: it?.unit ?? "pc", min: it ? String(num(it.min_qty)) : "1",
    inStore: "0", loc: it?.location ?? "", rate: it?.rate != null ? String(num(it.rate)) : "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { busy, error, run } = useRun(reload);

  const submit = async () => {
    if (await run(async () => {
      if (!f.name.trim()) throw new Error("Enter the name.");
      await push([{ table: "store_item", data: {
        id: it?.id ?? newId(), name: f.name.trim(), kind: f.kind, code: f.code.trim() || null, unit: f.unit.trim() || "pc", min_qty: Number(f.min) || 0, location: f.loc.trim() || null,
        ...(it ? {} : { qty: Number(f.inStore) || 0 }),
        ...(owner ? { rate: Number(f.rate) || 0 } : {}),
      } }]);
    })) onClose();
  };

  return (
    <Modal title={it ? "Edit item" : "New store item"} onClose={onClose} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2"><Field label="Name" value={f.name} onChange={set("name")} /></div>
        <Select label="Kind" value={f.kind} onChange={(v) => set("kind")(v || "Spare")} options={KINDS.map(([k, l]) => ({ value: k, label: l }))} />
        <Field label="Code or part no." value={f.code} onChange={set("code")} />
        <Field label="Unit" value={f.unit} onChange={set("unit")} />
        <Field label="Minimum to keep" value={f.min} onChange={(v) => set("min")(decimal(v))} />
        {it ? null : <Field label="In store now" value={f.inStore} onChange={(v) => set("inStore")(decimal(v))} />}
        <Field label="Location" value={f.loc} onChange={set("loc")} />
        {owner ? <Field label="Rate (Rs per unit)" value={f.rate} onChange={(v) => set("rate")(decimal(v))} /> : null}
      </div>
      <Footer error={error} busy={busy} label={it ? "Save" : "Add"} onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}

export { Footer as DialogFooter };

/** One figure in the row at the top of a page; `alert` turns the number red. */
export function Fig({ label, value, alert, note }: { label: string; value: ReactNode; alert?: boolean; note?: ReactNode }) {
  return (
    <div className={`rounded-2xl border bg-card p-4 shadow-sm ${alert ? "border-red-300" : "border-[#d9d5cc]"}`}>
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <b className={`block text-3xl ${alert ? "text-red-700" : "text-slate-900"}`}>{value}</b>
      {note ? <small className="text-xs text-slate-500">{note}</small> : null}
    </div>
  );
}
