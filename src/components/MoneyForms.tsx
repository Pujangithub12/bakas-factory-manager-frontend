import { useState } from "react";
import { useAuth } from "../lib/auth";
import { useData } from "../lib/data";
import { newId, push } from "../lib/api";
import { Button, ErrorText, Field, Modal, Select, TextArea, useRun } from "./ui";
import { inputToIso, isoToInput, kgFmt } from "../lib/util";
import { balances, billOf, priceSale, rsK, rs2, vatRate } from "../shared/money";
import { num, ticketNet } from "../shared/rules";
import type { Row } from "../shared/time";

const MODES = ["Credit", "Cash", "Other"].map((v) => ({ value: v, label: v }));

/** Enter or change the bill of a sales truck (the bill itself is written in the printed bill book). */
export function BillModal({ ticket, onClose, onSaved }: { ticket: Row; onClose: () => void; onSaved: () => void }) {
  const { D } = useData();
  const { session } = useAuth();
  const B = billOf(D, ticket.id);
  const owner = session!.roles.includes("Owner");
  const locked = !!B && B.rate == null && !owner;
  const [f, setF] = useState({
    no: B?.bill_no ?? String(ticket.challan_no ?? "").split("/").pop() ?? "",
    date: B?.bill_date ? String(B.bill_date).slice(0, 10) : new Date().toISOString().slice(0, 10),
    rate: String(B ? num(B.rate) : priceSale(D, ticket.material_id, ticket.buyer_id) || ""),
    vat: String(B?.vat_pct != null ? num(B.vat_pct) : vatRate(D, ticket.material_id)),
    mode: B?.payment_mode ?? "Credit",
    po: B?.po_no ?? ticket.po_no ?? "",
    note: B?.note ?? "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { busy, error, run } = useRun(onSaved);
  const net = ticketNet(ticket) ?? 0;
  const amt = net * Number(f.rate || 0);
  const buyer = D.buyer.find((b) => b.id === ticket.buyer_id)?.name ?? "";
  const product = D.material.find((m) => m.id === ticket.material_id)?.name ?? "";

  return (
    <Modal title={B ? `Bill ${B.bill_no}` : "Enter the bill"} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">{buyer} · {product} · {kgFmt(net)} kg · challan {ticket.challan_no}</p>
      {locked ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">This bill was entered by someone else or more than 7 days ago. Ask the Owner to change it.</p> : (
        <>
          <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">Write the bill in the bill book as usual, then enter it here. The bill no. is normally the same as the challan no.</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Bill no. (from the bill book)" value={f.no} onChange={set("no")} />
            <Field label="Bill date" type="date" value={f.date} onChange={set("date")} />
            <Field label="Rate (Rs per kg)" value={f.rate} onChange={(v) => set("rate")(v.replace(/[^\d.]/g, ""))} />
            <Field label="VAT %" value={f.vat} onChange={(v) => set("vat")(v.replace(/[^\d.]/g, ""))} hint="Pellets 13%, briquettes none" />
            <Select label="Payment" value={f.mode} onChange={set("mode")} options={MODES} />
            <Field label="Buyer's P.O. no." value={f.po} onChange={set("po")} />
          </div>
          <div className="mt-3"><TextArea label="Note" value={f.note} onChange={set("note")} /></div>
          <p className="mt-2 text-sm text-brand-800">{kgFmt(net)} kg x Rs {Number(f.rate || 0).toFixed(2)} = {rs2(amt)}{Number(f.vat) ? ` + VAT ${f.vat}% ${rs2((amt * Number(f.vat)) / 100)} = ${rs2(amt * (1 + Number(f.vat) / 100))}` : ""}. Check it against the bill book.</p>
        </>
      )}
      <div className="mt-3 space-y-3">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Close</Button>
          {locked ? null : (
            <Button disabled={busy} onClick={async () => {
              const ok = await run(async () => {
                if (!f.no.trim()) throw new Error("Enter the bill no. from the bill book");
                if (!(Number(f.rate) > 0)) throw new Error("Enter the rate");
                if (Number(f.vat) < 0 || Number(f.vat) > 30) throw new Error("Check the VAT %");
                await push([{ table: "sales_bill", data: {
                  id: B?.id ?? newId(), ticket_id: ticket.id, bill_no: f.no.trim(), bill_date: f.date, rate: Number(f.rate), vat_pct: Number(f.vat || 0), payment_mode: f.mode,
                  po_no: f.po.trim() || null, note: f.note.trim() || null, ...(B ? {} : { entered_by: session!.person.id, entered_at: new Date().toISOString() }),
                } }]);
              });
              if (ok) onClose();
            }}>{B ? "Save changes" : "Save bill"}</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** A payment to a supplier ("paid") or money received from a buyer ("received"). */
export function PaymentModal({ dir, payment, onClose, onSaved }: { dir: "paid" | "received"; payment?: Row; onClose: () => void; onSaved: () => void }) {
  const { D } = useData();
  const { session } = useAuth();
  const owner = session!.roles.includes("Owner");
  const list = dir === "paid" ? D.supplier : D.buyer;
  const bal = owner ? balances(D, dir === "paid" ? "in" : "out") : {};
  const [f, setF] = useState({
    party: payment ? payment.supplier_id ?? payment.buyer_id : "",
    amount: payment ? String(num(payment.amount)) : "",
    mode: payment?.mode ?? "Bank",
    ref: payment?.ref ?? "",
    at: isoToInput(payment?.at ?? new Date().toISOString()),
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const { busy, error, run } = useRun(onSaved);

  return (
    <Modal title={payment ? "Change payment" : dir === "paid" ? "Payment to a supplier" : "Money received from a buyer"} onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Select label={dir === "paid" ? "Supplier" : "Buyer"} value={f.party} onChange={set("party")} options={list.map((p) => ({ value: p.id, label: owner ? `${p.name} (balance ${rsK(bal[p.id]?.bal ?? 0)})` : p.name }))} />
        </div>
        <Field label="Amount (Rs)" value={f.amount} onChange={(v) => set("amount")(v.replace(/[^\d.]/g, ""))} />
        <Select label="Mode" value={f.mode} onChange={set("mode")} options={["Bank", "Cheque", "Cash"].map((v) => ({ value: v, label: v }))} />
        <Field label="Cheque or transfer no." value={f.ref} onChange={set("ref")} />
        <Field label="Date and time" type="datetime-local" value={f.at} onChange={set("at")} />
      </div>
      {!owner ? <p className="mt-2 text-xs text-slate-500">You can change this entry for 7 days. Balances are for the Owner.</p> : null}
      <div className="mt-3 space-y-3">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Close</Button>
          <Button disabled={busy} onClick={async () => {
            const ok = await run(async () => {
              if (!f.party) throw new Error(dir === "paid" ? "Choose the supplier" : "Choose the buyer");
              if (!(Number(f.amount) > 0)) throw new Error("Enter the amount");
              await push([{ table: "payment", data: {
                id: payment?.id ?? newId(), direction: dir, supplier_id: dir === "paid" ? f.party : null, buyer_id: dir === "received" ? f.party : null,
                at: inputToIso(f.at) ?? new Date().toISOString(), amount: Number(f.amount), mode: f.mode, ref: f.ref.trim() || null,
                ...(payment ? {} : { entered_by: session!.person.id, entered_at: new Date().toISOString() }),
              } }]);
            });
            if (ok) onClose();
          }}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
