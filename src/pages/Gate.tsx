import { useMemo, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { checkIn, checkOut, registerPerson } from "../lib/flows";
import { newId, push } from "../lib/api";
import { Badge, Button, ErrorText, Field, Modal, PageHeader, Select, Table, Td, useRun } from "../components/ui";
import { busyPeople, machineOf, mainRole, nextPassNo, onSiteMap, personName, rolesOf } from "../shared/rules";
import { fmtDateTime, fmtTime, nowIso, productionDayStart } from "../shared/time";

import { ROLE_LIST, grantableRoles } from "../lib/roles";

export default function Gate() {
  const { D, reload } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"all" | "in">("all");
  const [sel, setSel] = useState<string[]>([]);
  const [registering, setRegistering] = useState(false);
  const { busy, error, run } = useRun(reload);

  const site = useMemo(() => onSiteMap(D), [D]);
  const running = useMemo(() => busyPeople(D), [D]);
  const list = D.person
    .filter((p) => p.active)
    .filter((p) => !q.trim() || p.full_name.toLowerCase().includes(q.trim().toLowerCase()) || (p.mobile ?? "").includes(q.trim()))
    .filter((p) => (tab === "in" ? site.has(p.id) : true))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div>
      <PageHeader title="Gate register" sub={`${site.size} on site. Search by name or mobile, then tap In or Out.`}>
        <Button onClick={() => setRegistering(true)}>Register new person</Button>
      </PageHeader>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className="w-72 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Search name or mobile" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button small kind={tab === "all" ? "primary" : "ghost"} onClick={() => setTab("all")}>Everyone</Button>
        <Button small kind={tab === "in" ? "primary" : "ghost"} onClick={() => setTab("in")}>On site</Button>
        <span className="mx-2 text-slate-300">|</span>
        <span className="text-sm text-slate-500">{sel.length} selected</span>
        <Button small kind="soft" disabled={busy || !sel.length} onClick={() => run(() => checkIn(D, sel, me)).then(() => setSel([]))}>Check selected in</Button>
        <Button small kind="ghost" disabled={busy || !sel.length} onClick={() => run(() => checkOut(D, sel)).then(() => setSel([]))}>Check selected out</Button>
      </div>
      <div className="mb-3"><ErrorText text={error} /></div>

      <Table head={["", "Name", "Mobile", "Works as", "Status", ""]} empty={q ? "No one found. Use Register new person." : "No people yet."}>
        {list.map((p) => {
          const a = site.get(p.id);
          const r = running.get(p.id);
          return (
            <tr key={p.id}>
              <Td><input type="checkbox" className="h-4 w-4 accent-brand-700" checked={sel.includes(p.id)} onChange={() => toggle(p.id)} /></Td>
              <Td className="font-semibold">{p.full_name}</Td><Td>{p.mobile ?? "-"}</Td><Td>{mainRole(D, p.id) ?? "-"}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {a ? <Badge tone="good">In {fmtTime(a.gate_in)}</Badge> : <Badge>Out</Badge>}
                  {!p.checked ? <Badge tone="info">New</Badge> : null}
                  {r ? <Badge tone="warn">Running {machineOf(D, r.machine_id)?.tag}</Badge> : null}
                </div>
              </Td>
              <Td>{a ? <Button small kind="ghost" disabled={busy} onClick={() => run(() => checkOut(D, [p.id]))}>Out</Button> : <Button small disabled={busy} onClick={() => run(() => checkIn(D, [p.id], me))}>In</Button>}</Td>
            </tr>
          );
        })}
      </Table>

      <Visitors />

      {registering ? <RegisterModal onClose={() => setRegistering(false)} onSaved={reload} /> : null}
    </div>
  );
}

function RegisterModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { D } = useData();
  const { session } = useAuth();
  const mgmt = session!.roles.some((r) => ["Owner", "Manager", "Supervisor"].includes(r));
  const [f, setF] = useState({ name: "", mobile: "", address: "", idNo: "", role: "" });
  const { busy, error, run } = useRun(onSaved);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Modal title="Register a new person" onClose={onClose}>
      <div className="space-y-3">
        <Field label="Name as on the ID" value={f.name} onChange={set("name")} />
        <Field label="Mobile (10 digits)" value={f.mobile} onChange={(v) => set("mobile")(v.replace(/\D/g, "").slice(0, 10))} />
        <Field label="Address" value={f.address} onChange={set("address")} />
        <Field label="ID no. (if they have one)" value={f.idNo} onChange={set("idNo")} />
        <Select label="Works as" value={f.role} onChange={set("role")} options={ROLE_LIST.filter((r) => grantableRoles(session!.roles).includes(r)).map((r) => ({ value: r, label: r }))} />
        <p className="text-xs text-slate-500">They are checked in when you save. They show as "New" until the supervisor confirms their details.</p>
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={async () => { if (await run(() => registerPerson(D, session!.person.id, mgmt, f))) onClose(); }}>Register and check in</Button>
        </div>
      </div>
    </Modal>
  );
}

const PURPOSE = ["Meeting", "Buyer", "Supplier", "Delivery", "Contractor or repair", "Government or inspection", "Other"];
const COMPANY = {
  name: "Bakas Renewable Energy Ltd.", addr: "Kathmandu-11, Thapathali, Nepal", factory: "Factory: Ishworpur-5, Bailbas, Sarlahi",
  pan: "603907092", phone: "+977-1-5111032", email: "bakas.nepal@gmail.com",
};

/** Every visitor gets a numbered gate pass. Shows who is on site and who came today. */
function Visitors() {
  const { D, reload } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const canWrite = session!.roles.some((r) => ["Security", "Owner", "Manager", "Supervisor"].includes(r));
  const [adding, setAdding] = useState(false);
  const [passId, setPassId] = useState<string | null>(null);
  const { busy, error, run } = useRun(reload);

  const t0 = productionDayStart().getTime();
  const at = (v: any) => new Date(v).getTime();
  const on = D.visitor.filter((v) => !v.time_out);
  const today = D.visitor.filter((v) => at(v.time_in) >= t0);
  const list = [...on.filter((v) => at(v.time_in) < t0), ...today].sort((a, b) => String(b.time_in).localeCompare(String(a.time_in)));
  const pass = passId ? D.visitor.find((v) => v.id === passId) : undefined;

  return (
    <div className="mt-8">
      <PageHeader title="Visitors" sub={`${on.length} on site now · ${today.length} today. Every visitor gets a numbered gate pass.`}>
        {canWrite ? <Button onClick={() => setAdding(true)}>New gate pass</Button> : null}
      </PageHeader>
      <div className="mb-3"><ErrorText text={error} /></div>
      <Table head={["Pass", "Name", "Mobile", "From", "Purpose", "To meet", "People", "Vehicle", "In", "Out", ""]} empty="No visitors today.">
        {list.map((v) => (
          <tr key={v.id}>
            <Td className="font-semibold">{v.pass_no}</Td>
            <Td>{v.name}</Td><Td>{v.mobile ?? "-"}</Td><Td>{v.from_org ?? "-"}</Td><Td>{v.purpose}</Td>
            <Td>{personName(D, v.meet_person_id)}</Td><Td>{v.people_count ?? 1}</Td><Td>{v.vehicle_no ?? "-"}</Td>
            <Td>{fmtTime(v.time_in)}</Td>
            <Td>{v.time_out ? fmtTime(v.time_out) : <Badge tone="good">On site</Badge>}</Td>
            <Td>
              <div className="flex gap-1">
                <Button small kind="soft" onClick={() => setPassId(v.id)}>Pass</Button>
                {canWrite && !v.time_out ? (
                  <Button small kind="ghost" disabled={busy} onClick={() => run(() => push([{ table: "visitor", data: { id: v.id, time_out: nowIso(), out_by: me } }]))}>Check out</Button>
                ) : null}
              </div>
            </Td>
          </tr>
        ))}
      </Table>
      {adding ? <VisitorModal onClose={() => setAdding(false)} onSaved={reload} onMade={(id) => { setAdding(false); setPassId(id); }} /> : null}
      {pass ? <PassModal v={pass} onClose={() => setPassId(null)} /> : null}
    </div>
  );
}

function VisitorModal({ onClose, onSaved, onMade }: { onClose: () => void; onSaved: () => void | Promise<void>; onMade: (id: string) => void }) {
  const { D } = useData();
  const { session } = useAuth();
  const [f, setF] = useState({ name: "", phone: "", from: "", purpose: "Meeting", meet: "", count: "1", vehicle: "", idDoc: "", carrying: "" });
  const { busy, error, setError, run } = useRun(onSaved);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const staff = D.person.filter((p) => p.active && !rolesOf(D, p.id).some((r) => r === "Helper" || r === "Security"));

  const save = async () => {
    const n = f.name.trim().replace(/\s+/g, " ");
    const ph = f.phone.replace(/\D/g, "");
    if (n.length < 3) return setError("Enter the visitor’s name.");
    if (ph && ph.length !== 10) return setError("The mobile number should have 10 digits.");
    if (!f.meet) return setError("Choose who they are meeting.");
    const id = newId();
    const ok = await run(() => push([{ table: "visitor", data: {
      id, pass_no: nextPassNo(D), name: n, mobile: ph || null, from_org: f.from.trim() || null, purpose: f.purpose || "Other", meet_person_id: f.meet,
      people_count: Number(f.count) || 1, vehicle_no: f.vehicle.trim() || null, id_doc: f.idDoc.trim() || null, carrying: f.carrying.trim() || null,
      time_in: nowIso(), time_out: null, pass_by: session!.person.id, out_by: null,
    } }]));
    if (ok) onMade(id);
  };

  return (
    <Modal title="New visitor gate pass" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">Fill in before the visitor goes in. Print the pass or show it on the phone.</p>
        <Field label="Full name" value={f.name} onChange={set("name")} />
        <Field label="Mobile" value={f.phone} placeholder="98XXXXXXXX" onChange={(v) => set("phone")(v.replace(/\D/g, "").slice(0, 10))} />
        <Field label="From (company or address)" value={f.from} onChange={set("from")} />
        <Select label="Purpose" value={f.purpose} onChange={set("purpose")} options={PURPOSE.map((p) => ({ value: p, label: p }))} />
        <Select label="To meet" value={f.meet} onChange={set("meet")} options={staff.map((p) => ({ value: p.id, label: `${p.full_name} · ${rolesOf(D, p.id).join(", ")}` }))} />
        <Field label="People" type="number" value={f.count} onChange={(v) => set("count")(v.replace(/\D/g, ""))} />
        <Field label="Vehicle no. (optional)" value={f.vehicle} onChange={set("vehicle")} />
        <Field label="ID type and number" value={f.idDoc} placeholder="Citizenship, licence…" onChange={set("idDoc")} />
        <Field label="Carrying (tools, material)" value={f.carrying} onChange={set("carrying")} />
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={save}>Make pass</Button>
        </div>
      </div>
    </Modal>
  );
}

/** The printable gate pass. Printing shows only the pass. */
function PassModal({ v, onClose }: { v: Record<string, any>; onClose: () => void }) {
  const { D } = useData();
  const cell = "border border-slate-300 px-2 py-1";
  return (
    <Modal title={`Gate pass ${v.pass_no}`} onClose={onClose} wide>
      <style>{"@media print{body *{visibility:hidden}#gate-pass,#gate-pass *{visibility:visible}#gate-pass{position:fixed;left:0;top:0;width:100%;background:#fff;padding:24px}.no-print{display:none!important}}"}</style>
      <div className="no-print mb-3 flex items-center gap-2">
        <span className="flex-1 text-xs text-slate-500">Sample paper. Check the layout with your printed forms.</span>
        <Button onClick={() => window.print()}>Print</Button>
        <Button kind="ghost" onClick={onClose}>Close</Button>
      </div>
      <div id="gate-pass" className="rounded-lg border border-slate-300 p-5 text-sm">
        <div className="flex justify-between gap-4">
          <div><b>{COMPANY.name}</b><br />{COMPANY.addr}<br />{COMPANY.factory}<br />Tel: {COMPANY.phone} · {COMPANY.email}</div>
          <div className="text-right"><b>{v.pass_no}</b><br />{fmtDateTime(v.time_in)}<br />PAN/VAT No. {COMPANY.pan}</div>
        </div>
        <div className="my-4 text-center text-lg font-bold tracking-wide">VISITOR GATE PASS</div>
        <div className="mb-3 grid grid-cols-2 gap-4">
          <div><span className="text-xs text-slate-500">Name</span><br /><b className="text-xl">{v.name}</b><br />{v.mobile ?? ""}</div>
          <div>
            <span className="text-xs text-slate-500">From</span> {v.from_org || "—"}<br />
            <span className="text-xs text-slate-500">Purpose</span> {v.purpose}<br />
            <span className="text-xs text-slate-500">To meet</span> {personName(D, v.meet_person_id)}
          </div>
        </div>
        <table className="w-full border-collapse text-left">
          <tbody>
            <tr><th className={cell}>Time in</th><td className={cell}>{fmtDateTime(v.time_in)}</td><th className={cell}>Time out</th><td className={cell}>{v.time_out ? fmtTime(v.time_out) : ""}</td></tr>
            <tr><th className={cell}>Vehicle</th><td className={cell}>{v.vehicle_no || "—"}</td><th className={cell}>People</th><td className={cell}>{v.people_count ?? 1}</td></tr>
            <tr><th className={cell}>ID</th><td className={cell} colSpan={3}>{v.id_doc || "—"}</td></tr>
            {v.carrying ? <tr><th className={cell}>Carrying</th><td className={cell} colSpan={3}>{v.carrying}</td></tr> : null}
          </tbody>
        </table>
        <p className="mt-3">Wear the pass at all times. Return it at the gate when you leave. Safety shoes and helmet in the plant area.</p>
        <div className="mt-10 grid grid-cols-3 gap-6 text-center text-xs text-slate-600">
          <div className="border-t border-slate-400 pt-1">Security</div><div className="border-t border-slate-400 pt-1">Person met</div><div className="border-t border-slate-400 pt-1">Visitor</div>
        </div>
      </div>
    </Modal>
  );
}
