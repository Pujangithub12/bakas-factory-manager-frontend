import { useMemo, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { checkIn, checkOut, registerPerson } from "../lib/flows";
import { Badge, Button, ErrorText, Field, Modal, PageHeader, Select, Table, Td, useRun } from "../components/ui";
import { busyPeople, machineOf, mainRole, onSiteMap } from "../shared/rules";
import { fmtTime } from "../shared/time";

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
