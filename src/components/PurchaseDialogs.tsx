// Dialogs for purchase requests: new request, mark ordered, reject.
import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/data";
import { newId, push } from "../lib/api";
import { Field, Modal, Select, useRun } from "./ui";
import { DialogFooter, Radios, Sub, decimal } from "./StoreDialogs";
import { isoToInput } from "../lib/util";
import { nextPrNo, num, prText } from "../shared/rules";
import { DAY, fmtDateTime, nowIso, type Row } from "../shared/time";

/** YYYY-MM-DD, Nepal time, n days from today. */
export const dateIn = (n: number) => isoToInput(new Date(Date.now() + n * DAY).toISOString()).slice(0, 10);

type Line = { itemId: string; desc: string; q: string; unit: string };

/** Ask for something. With itemId (a below-minimum item) the first line is filled in. */
export function NewPRDialog({ itemId, onClose }: { itemId?: string; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const pre = itemId ? D.store_item.find((i) => i.id === itemId) : undefined;
  const blank: Line = { itemId: "", desc: "", q: "", unit: "" };
  const [lines, setLines] = useState<Line[]>([
    pre ? { itemId: pre.id, desc: "", q: String(Math.max(1, num(pre.min_qty) * 2 - num(pre.qty))), unit: pre.unit ?? "" } : { ...blank },
    { ...blank },
    { ...blank },
  ]);
  const [reason, setReason] = useState(pre ? "Below the minimum stock" : "");
  const [needBy, setNeedBy] = useState(dateIn(7));
  const [prio, setPrio] = useState("Normal");
  const { busy, error, run } = useRun(reload);
  const set = (i: number, patch: Partial<Line>) => setLines((l) => l.map((x, n) => (n === i ? { ...x, ...patch } : x)));
  const items = [...D.store_item].sort((a, b) => a.name.localeCompare(b.name));

  const submit = async () => {
    if (await run(async () => {
      const used = lines.map((l, i) => ({ l, i })).filter(({ l }) => l.itemId || l.desc.trim());
      for (const { l, i } of used) if (!(Number(l.q) > 0)) throw new Error(`Enter the quantity for item ${i + 1}.`);
      if (!used.length) throw new Error("Add at least one item.");
      if (!reason.trim()) throw new Error("Say why it is needed.");
      const id = newId();
      await push([
        { table: "purchase_request", data: { id, pr_no: nextPrNo(D), requested_by: session!.person.id, requested_at: nowIso(), reason: reason.trim(), need_by: needBy || null, priority: prio, status: "Requested", approved_by: null, approved_at: null, reject_reason: null, ordered_by: null, ordered_at: null, vendor: null, expected_on: null, received_by: null, received_at: null } },
        ...used.map(({ l }) => {
          const it = l.itemId ? D.store_item.find((x) => x.id === l.itemId) : undefined;
          return { table: "purchase_request_line", data: { id: newId(), pr_id: id, item_id: l.itemId || null, description: l.desc.trim() || it?.name || null, qty: Number(l.q), unit: l.unit.trim() || it?.unit || null } };
        }),
      ]);
    })) onClose();
  };

  return (
    <Modal title="New purchase request" onClose={onClose} wide>
      <Sub>Say what is needed, how many and by when.</Sub>
      <div className="space-y-4">
        {lines.map((l, i) => (
          <div key={i} className="grid gap-3 rounded-lg bg-slate-50 p-3 md:grid-cols-2">
            <Select label={`Item ${i + 1}${i ? " (optional)" : ""}`} value={l.itemId} placeholder="Not a store item: write it"
              onChange={(v) => { const it = D.store_item.find((x) => x.id === v); set(i, { itemId: v, unit: it?.unit ?? l.unit }); }}
              options={items.map((x) => ({ value: x.id, label: x.name }))} />
            <Field label="Or describe it" value={l.desc} onChange={(v) => set(i, { desc: v })} placeholder="e.g. Safety helmets" />
            <Field label="Quantity" value={l.q} onChange={(v) => set(i, { q: decimal(v) })} />
            <Field label="Unit" value={l.unit} onChange={(v) => set(i, { unit: v })} />
          </div>
        ))}
        <Field label="Why it is needed" value={reason} onChange={setReason} />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Need by" type="date" value={needBy} onChange={setNeedBy} />
          <Radios label="Priority" value={prio} onChange={setPrio} options={[{ value: "Normal", label: "Normal" }, { value: "Urgent", label: "Urgent", sub: "Machine stopped or unsafe" }]} />
        </div>
      </div>
      <DialogFooter error={error} busy={busy} label="Send request" onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}

/** Supplier, expected date and (Owner only) the amount. */
export function OrderDialog({ pr, onClose }: { pr: Row; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const owner = session!.roles.includes("Owner");
  const [vendor, setVendor] = useState("");
  const [exp, setExp] = useState(dateIn(3));
  const [amount, setAmount] = useState("");
  const { busy, error, run } = useRun(reload);

  const submit = async () => {
    if (await run(async () => {
      if (!vendor.trim()) throw new Error("Enter the supplier.");
      await push([{ table: "purchase_request", data: {
        id: pr.id, status: "Ordered", vendor: vendor.trim(), expected_on: exp || null, ordered_by: session!.person.id, ordered_at: nowIso(),
        ...(owner && Number(amount) > 0 ? { amount: Number(amount) } : {}),
      } }]);
    })) onClose();
  };

  return (
    <Modal title={`Order ${pr.pr_no}`} onClose={onClose}>
      <Sub>{prText(D, pr)}</Sub>
      <div className="space-y-3">
        <Field label="Supplier" value={vendor} onChange={setVendor} />
        <Field label="Expected on" type="date" value={exp} onChange={setExp} />
        {owner ? <Field label="Amount (Rs)" value={amount} onChange={(v) => setAmount(v.replace(/\D/g, ""))} /> : null}
      </div>
      <DialogFooter error={error} busy={busy} label="Mark ordered" onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}

export function RejectDialog({ pr, onClose }: { pr: Row; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const [why, setWhy] = useState("");
  const { busy, error, run } = useRun(reload);

  const submit = async () => {
    if (await run(async () => {
      if (!why.trim()) throw new Error("Give a reason.");
      await push([{ table: "purchase_request", data: { id: pr.id, status: "Rejected", reject_reason: why.trim(), approved_by: session!.person.id, approved_at: nowIso() } }]);
    })) onClose();
  };

  return (
    <Modal title={`Reject ${pr.pr_no}`} onClose={onClose}>
      <Sub>{prText(D, pr)}</Sub>
      <Field label="Reason" value={why} onChange={setWhy} placeholder="Tell the person why" />
      <DialogFooter error={error} busy={busy} label="Reject" kind="danger" onClose={onClose} onSubmit={submit} />
    </Modal>
  );
}

/** "2 Nov" for a timestamp (Nepal time). */
export const dLab = (v: unknown) => fmtDateTime(v).replace(/ \d\d:\d\d$/, "");
/** "9 Nov" for a date column. */
export const dateLab = (v: unknown) => (v ? new Date(v as string).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "-");
