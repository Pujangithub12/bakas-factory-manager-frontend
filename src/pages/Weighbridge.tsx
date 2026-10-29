import { useEffect, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { newId, push } from "../lib/api";
import { truckIn, truckOut, weighOut, stopFilling } from "../lib/flows";
import { Badge, Button, Card, ErrorText, Field, Modal, PageHeader, Select, Table, TextArea, Td, useRun } from "../components/ui";
import { DAY, kgFmt } from "../lib/util";
import { activeBatch, batchCode, batchMaterial, batchTickets, nextChallan, num, suggestYard, ticketNet } from "../shared/rules";
import { fmtDateTime, fmtTime, type Row } from "../shared/time";

export default function Weighbridge() {
  const { D, reload, needDays, challan } = useData();
  const [modal, setModal] = useState<"in" | "out" | null>(null);
  const [weighing, setWeighing] = useState<Row | null>(null);
  const [days, setDays] = useState("1");
  const { error, run } = useRun(reload);
  useEffect(() => needDays(Number(days) + 2), [days, needDays]);

  const onBridge = D.weigh_ticket.filter((t) => t.second_kg == null).sort((a, b) => b.first_at.localeCompare(a.first_at));
  const since = Date.now() - Number(days) * DAY;
  const done = D.weigh_ticket.filter((t) => t.second_kg != null && new Date(t.second_at).getTime() >= since).sort((a, b) => b.second_at.localeCompare(a.second_at));
  const matName = (id: string) => D.material.find((m) => m.id === id)?.name ?? "-";
  const party = (t: Row) => (t.direction === "in" ? D.supplier : D.buyer).find((p) => p.id === (t.direction === "in" ? t.supplier_id : t.buyer_id))?.name ?? "-";
  const yardOf = (t: Row) => { const b = D.yard_batch.find((x) => x.id === t.batch_id); return b ? batchCode(D, b) : "-"; };

  return (
    <div>
      <PageHeader title="Weighbridge" sub="Every truck is weighed twice, in kg, as on the weighbridge display.">
        <Button onClick={() => setModal("in")}>Truck in</Button>
        <Button kind="soft" onClick={() => setModal("out")}>Truck out (sale)</Button>
      </PageHeader>
      <ErrorText text={error} />

      <h2 className="mb-2 mt-2 font-semibold">On the weighbridge ({onBridge.length})</h2>
      <Table head={["Serial", "Vehicle", "Type", "Material", "Party", "First weight", "Yard / challan", "Since", ""]} empty="No truck is waiting for its second weight.">
        {onBridge.map((t) => (
          <tr key={t.id}>
            <Td>#{t.wbsn}</Td><Td className="font-semibold">{t.vehicle_no}</Td>
            <Td><Badge tone={t.direction === "in" ? "info" : "warn"}>{t.direction === "in" ? "In" : "Sale"}</Badge></Td>
            <Td>{matName(t.material_id)}</Td><Td>{party(t)}</Td>
            <Td>{kgFmt(num(t.first_kg))} kg {t.direction === "in" ? "gross" : "empty"}</Td>
            <Td>{t.direction === "in" ? yardOf(t) : t.challan_no}</Td><Td>{fmtTime(t.first_at)}</Td>
            <Td><Button small onClick={() => setWeighing(t)}>Weigh out</Button></Td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 font-semibold">Yards</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {[...D.yard].sort((a, b) => a.letter.localeCompare(b.letter)).map((y) => {
          const b = activeBatch(D, y.id);
          return (
            <Card key={y.id}>
              <div className="flex items-center justify-between">
                <span className="font-bold">{y.name}</span>
                {!b ? <Badge>Empty</Badge> : b.started_at ? <Badge tone="info">Feeding</Badge> : b.closed_at ? <Badge tone="warn">Closed</Badge> : <Badge tone="good">Filling</Badge>}
              </div>
              {b ? <p className="mt-1 text-sm text-slate-600">{batchCode(D, b)} · {batchMaterial(D, b)?.name ?? "no truck yet"} · {batchTickets(D, b.id).length}/{y.holds_trucks ?? "-"} trucks</p> : <p className="mt-1 text-sm text-slate-500">Ready for the next truck. Limit {y.holds_trucks ?? "-"} trucks.</p>}
              {b && !b.closed_at ? <div className="mt-2"><Button small kind="ghost" onClick={() => run(() => stopFilling(b.id))}>Stop filling</Button></div> : null}
            </Card>
          );
        })}
      </div>

      <div className="mb-2 mt-6 flex items-center justify-between">
        <h2 className="font-semibold">Register</h2>
        <Select value={days} onChange={(v) => setDays(v || "1")} placeholder="Period" options={[{ value: "1", label: "Last 24 hours" }, { value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }]} />
      </div>
      <Table head={["Weighed out", "Serial", "Vehicle", "Direction", "Material", "Party", "Gross / empty", "Net", "Yard / challan", "Moisture"]} empty="No finished trucks in this period.">
        {done.map((t) => (
          <tr key={t.id}>
            <Td>{fmtDateTime(t.second_at)}</Td><Td>#{t.wbsn}</Td><Td className="font-semibold">{t.vehicle_no}</Td>
            <Td><Badge tone={t.direction === "in" ? "info" : "warn"}>{t.direction === "in" ? "In" : "Sale"}</Badge></Td>
            <Td>{matName(t.material_id)}</Td><Td>{party(t)}</Td>
            <Td>{kgFmt(num(t.first_kg))} / {kgFmt(num(t.second_kg))}</Td><Td className="font-semibold">{kgFmt(ticketNet(t))} kg</Td>
            <Td>{t.direction === "in" ? yardOf(t) : t.challan_no}</Td>
            <Td>{t.direction === "in" ? [t.moisture_1, t.moisture_2, t.moisture_3].map((v) => (v == null ? "-" : num(v))).join(" / ") : ""}</Td>
          </tr>
        ))}
      </Table>

      {modal === "in" ? <TruckInModal onClose={() => setModal(null)} onSaved={reload} /> : null}
      {modal === "out" ? <TruckOutModal suggestion={nextChallan(D, challan)} onClose={() => setModal(null)} onSaved={reload} /> : null}
      {weighing ? <WeighOutModal ticket={weighing} onClose={() => setWeighing(null)} onSaved={reload} /> : null}
    </div>
  );
}

const VEHICLES = ["Truck", "Tractor", "Trailer", "Other"].map((v) => ({ value: v, label: v }));

/** Add a supplier or buyer without leaving the form. */
function PartyAdder({ table, onAdded }: { table: "supplier" | "buyer"; onAdded: (id: string) => void }) {
  const { reload } = useData();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { busy, error, run } = useRun(reload);
  if (!open) return <Button small kind="ghost" onClick={() => setOpen(true)}>New {table}</Button>;
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <Field label={`${table === "supplier" ? "Supplier" : "Buyer"} name`} value={name} onChange={setName} />
      <ErrorText text={error} />
      <div className="flex gap-2">
        <Button small disabled={busy || !name.trim()} onClick={async () => {
          const id = newId();
          const ok = await run(() => push([{ table, data: table === "supplier"
            ? { id, name: name.trim(), phone: null, address: null, pan: null, usually_supplies: null }
            : { id, name: name.trim(), phone: null, address: null, pan_vat: null, products: null } }]));
          if (ok) { onAdded(id); setOpen(false); setName(""); }
        }}>Add</Button>
        <Button small kind="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

function TruckInModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { D } = useData();
  const { session } = useAuth();
  const [f, setF] = useState({ wbsn: "", vehicleNo: "", vehicleType: "Truck", driver: "", contact: "", supplierId: "", materialId: "", first: "", remarks: "", yardId: "" });
  const [m, setM] = useState<[string, string, string]>(["", "", ""]);
  const [touched, setTouched] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useRun(onSaved);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const suggested = f.materialId ? suggestYard(D, f.materialId) : undefined;
  useEffect(() => { if (!touched) setF((x) => ({ ...x, yardId: suggested?.id ?? "" })); }, [suggested?.id, touched]);

  return (
    <Modal title="Truck in (raw material)" onClose={onClose} wide>
      <p className="mb-3 text-sm text-slate-500">The first weight is the gross weight.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Weighbridge serial no." value={f.wbsn} onChange={(v) => set("wbsn")(v.replace(/\D/g, ""))} />
        <Field label="Vehicle no." value={f.vehicleNo} onChange={set("vehicleNo")} />
        <Select label="Vehicle type" value={f.vehicleType} onChange={set("vehicleType")} options={VEHICLES} />
        <Field label="Gross weight (kg)" value={f.first} onChange={(v) => set("first")(v.replace(/\D/g, ""))} />
        <Field label="Driver name" value={f.driver} onChange={set("driver")} />
        <Field label="Driver contact" value={f.contact} onChange={set("contact")} />
        <div className="space-y-2">
          <Select label="Supplier" value={f.supplierId} onChange={set("supplierId")} options={D.supplier.map((s) => ({ value: s.id, label: s.name }))} />
          <PartyAdder table="supplier" onAdded={set("supplierId")} />
        </div>
        <Select label="Material" value={f.materialId} onChange={(v) => { set("materialId")(v); setTouched(false); }} options={D.material.filter((x) => x.kind === "Raw").map((x) => ({ value: x.id, label: x.name }))} />
        {[0, 1, 2].map((i) => <Field key={i} label={`Moisture ${i + 1} (%)`} value={m[i]} onChange={(v) => setM((x) => { const n = [...x] as [string, string, string]; n[i] = v; return n; })} />)}
        <Select
          label="Unload at"
          value={f.yardId}
          onChange={(v) => { set("yardId")(v); setTouched(true); }}
          options={D.yard.map((y) => { const b = activeBatch(D, y.id); return { value: y.id, label: `${y.name} (${b ? `${batchCode(D, b)}${b.closed_at ? " closed" : ""} ${batchTickets(D, b.id).length}/${y.holds_trucks ?? "-"}` : "empty"})` }; })}
        />
        <p className="self-end text-sm text-slate-500">{suggested && !touched ? `Suggested: ${suggested.name}` : f.materialId && !suggested ? "No yard is free for this material. Choose one." : ""}</p>
      </div>
      <div className="mt-3"><TextArea label="Remarks" value={f.remarks} onChange={set("remarks")} /></div>
      <div className="mt-3 space-y-3">
        <ErrorText text={error} />
        {notice ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{notice}</p> : null}
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Close</Button>
          <Button disabled={busy} onClick={async () => { const ok = await run(async () => setNotice(await truckIn(D, session!.person.id, { ...f, moisture: m }))); if (ok) { setNotice(null); onClose(); } }}>Save truck in</Button>
        </div>
      </div>
    </Modal>
  );
}

function TruckOutModal({ suggestion, onClose, onSaved }: { suggestion: string; onClose: () => void; onSaved: () => void }) {
  const { D } = useData();
  const { session } = useAuth();
  const [f, setF] = useState({ wbsn: "", vehicleNo: "", vehicleType: "Truck", driver: "", contact: "", buyerId: "", materialId: "", first: "", remarks: "", challan: suggestion, po: "" });
  const { busy, error, run } = useRun(onSaved);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <Modal title="Truck out (sale)" onClose={onClose} wide>
      <p className="mb-3 text-sm text-slate-500">The first weight is the empty truck.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Weighbridge serial no." value={f.wbsn} onChange={(v) => set("wbsn")(v.replace(/\D/g, ""))} />
        <Field label="Vehicle no." value={f.vehicleNo} onChange={set("vehicleNo")} />
        <Select label="Vehicle type" value={f.vehicleType} onChange={set("vehicleType")} options={VEHICLES} />
        <Field label="Empty truck weight (kg)" value={f.first} onChange={(v) => set("first")(v.replace(/\D/g, ""))} />
        <Field label="Driver name" value={f.driver} onChange={set("driver")} />
        <Field label="Driver contact" value={f.contact} onChange={set("contact")} />
        <div className="space-y-2">
          <Select label="Buyer" value={f.buyerId} onChange={set("buyerId")} options={D.buyer.map((s) => ({ value: s.id, label: s.name }))} />
          <PartyAdder table="buyer" onAdded={set("buyerId")} />
        </div>
        <Select label="Product" value={f.materialId} onChange={set("materialId")} options={D.material.filter((x) => x.kind !== "Raw").map((x) => ({ value: x.id, label: x.name }))} />
        <Field label="Challan no. (from the challan book)" value={f.challan} onChange={set("challan")} hint="Next number suggested. The bill gets the same number." />
        <Field label="Buyer's P.O. no." value={f.po} onChange={set("po")} />
      </div>
      <div className="mt-3"><TextArea label="Remarks" value={f.remarks} onChange={set("remarks")} /></div>
      <div className="mt-3 space-y-3">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Close</Button>
          <Button disabled={busy} onClick={async () => { if (await run(() => truckOut(D, session!.person.id, f))) onClose(); }}>Save truck out</Button>
        </div>
      </div>
    </Modal>
  );
}

function WeighOutModal({ ticket, onClose, onSaved }: { ticket: Row; onClose: () => void; onSaved: () => void }) {
  const { session } = useAuth();
  const [second, setSecond] = useState("");
  const { busy, error, run } = useRun(onSaved);
  const isIn = ticket.direction === "in";
  const s = Number(second);
  const net = second && Number.isInteger(s) ? (isIn ? num(ticket.first_kg) - s : s - num(ticket.first_kg)) : null;
  return (
    <Modal title={`Weigh out ${ticket.vehicle_no}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">#{ticket.wbsn} · {isIn ? "Gross" : "Empty"} {kgFmt(num(ticket.first_kg))} kg at {fmtTime(ticket.first_at)}</p>
      <Field label={isIn ? "Second weight: empty truck, tare (kg)" : "Second weight: loaded truck, gross (kg)"} value={second} onChange={(v) => setSecond(v.replace(/\D/g, ""))} />
      {net != null ? <p className={`mt-2 text-lg font-bold ${net > 0 ? "text-emerald-700" : "text-red-700"}`}>Net {kgFmt(net)} kg</p> : null}
      <p className="mt-1 text-xs text-slate-500">{isIn ? "The net goes to the yard." : "The net comes off the store stock."}</p>
      <div className="mt-3 space-y-3">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={async () => { if (await run(() => weighOut(ticket, second, session!.person.id))) onClose(); }}>Weigh out</Button>
        </div>
      </div>
    </Modal>
  );
}
