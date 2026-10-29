import { useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { confirmWorker, markOnDuty, setInCharge, toggleOperatorMachine } from "../lib/flows";
import { Badge, Button, Card, Check, ErrorText, Field, Modal, PageHeader, Select, Table, Td, useRun } from "../components/ui";
import { onSiteMap, rolesOf } from "../shared/rules";
import { fmtTime, nextShiftWindow, shiftWindow, type Row, type ShiftWindow } from "../shared/time";

const IN_CHARGE_ROLES = ["Supervisor", "Manager", "Operator", "Fitter"];

export default function Crew() {
  const { D, reload } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const { busy, error, run } = useRun(reload);
  const [machinesFor, setMachinesFor] = useState<Row | null>(null);
  const [pinFor, setPinFor] = useState<Row | null>(null);

  const now = shiftWindow(D.shift);
  const next = now ? nextShiftWindow(D.shift, now) : null;
  const site = onSiteMap(D);
  const candidates = D.person.filter((p) => p.active && rolesOf(D, p.id).some((r) => IN_CHARGE_ROLES.includes(r)));

  const inCharge = (w: ShiftWindow | null) => D.shift_in_charge.find((s) => w && new Date(s.shift_start).getTime() === w.start.getTime())?.person_id ?? "";

  const block = (title: string, w: ShiftWindow | null) => (
    <Card>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}{w ? ` · ${w.shift.name} ${fmtTime(w.start.toISOString())}-${fmtTime(w.end.toISOString())}` : ""}</div>
      {w ? (
        <div className="mt-2">
          <Select value={inCharge(w)} onChange={(v) => v && run(() => setInCharge(w.start.toISOString(), w.shift.id, v, me))} placeholder="Not set" options={candidates.map((p) => ({ value: p.id, label: `${p.full_name} (${rolesOf(D, p.id)[0] ?? ""})` }))} />
        </div>
      ) : <p className="mt-2 text-sm text-slate-500">No shifts are set up.</p>}
    </Card>
  );

  return (
    <div>
      <PageHeader title="Shift & crew" sub="The person in charge gets the supervisor screens on their phone for that shift." />
      <div className="mb-4"><ErrorText text={error} /></div>
      <div className="mb-6 grid gap-3 md:grid-cols-2">{block("In charge now", now)}{block("In charge next shift", next)}</div>

      <h2 className="mb-2 font-semibold">On site ({site.size})</h2>
      <Table head={["Name", "Works as", "Gate", "On duty", "Details", ""]} empty="No one is checked in.">
        {[...site.entries()].map(([id, a]) => {
          const p = D.person.find((x) => x.id === id);
          if (!p) return null;
          return (
            <tr key={id}>
              <Td className="font-semibold">{p.full_name} {!p.checked ? <Badge tone="info">New</Badge> : null}</Td>
              <Td>{rolesOf(D, id).join(", ") || "-"}</Td>
              <Td>{fmtTime(a.gate_in)}</Td>
              <Td>{a.on_duty_at ? <Badge tone="good">{fmtTime(a.on_duty_at)}</Badge> : <Badge tone="warn">Not yet</Badge>}</Td>
              <Td className="text-xs text-slate-500">{!p.checked ? [p.address, p.id_no && `ID ${p.id_no}`, p.mobile].filter(Boolean).join(" · ") : ""}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {!p.checked ? <Button small disabled={busy} onClick={() => run(() => confirmWorker(id, me))}>Confirm details</Button> : null}
                  {!a.on_duty_at ? <Button small kind="soft" disabled={busy} onClick={() => run(() => markOnDuty(a.id, me))}>Mark on duty</Button> : null}
                  {rolesOf(D, id).includes("Operator") ? <Button small kind="ghost" onClick={() => setMachinesFor(p)}>Machines</Button> : null}
                  <Button small kind="ghost" onClick={() => setPinFor(p)}>PIN</Button>
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>

      {machinesFor ? <MachinesModal person={machinesFor} onClose={() => setMachinesFor(null)} /> : null}
      {pinFor ? <PinModal person={pinFor} onClose={() => setPinFor(null)} /> : null}
    </div>
  );
}

function MachinesModal({ person, onClose }: { person: Row; onClose: () => void }) {
  const { D, reload } = useData();
  const { busy, error, run } = useRun(reload);
  return (
    <Modal title={`Machines for ${person.full_name}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">Every operator can run the briquette machine and both chippers.</p>
      <div className="space-y-1">
        {[...D.machine].sort((a, b) => a.tag.localeCompare(b.tag)).map((m) => {
          const always = m.stage === "briquette" || m.stage === "chip";
          const ticked = D.operator_machine.some((o) => o.person_id === person.id && o.machine_id === m.id);
          return <Check key={m.id} label={`${m.tag} · ${m.name}${always ? " (every operator)" : ""}`} value={always || ticked} onChange={() => !always && !busy && run(() => toggleOperatorMachine(person.id, m.id, !ticked))} />;
        })}
      </div>
      <div className="mt-3"><ErrorText text={error} /></div>
      <div className="mt-4 flex justify-end"><Button onClick={onClose}>Done</Button></div>
    </Modal>
  );
}

function PinModal({ person, onClose }: { person: Row; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run } = useRun();
  return (
    <Modal title={`PIN for ${person.full_name}`} onClose={onClose}>
      <Field label="New 6-digit PIN" type="password" value={pin} onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))} />
      {done ? <p className="mt-2 text-sm text-emerald-700">PIN set. {person.full_name} can sign in with it.</p> : null}
      <div className="mt-3"><ErrorText text={error} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button kind="ghost" onClick={onClose}>Close</Button>
        <Button disabled={busy || pin.length !== 6} onClick={() => run(async () => { await api(`/people/${person.id}/pin`, { body: { pin } }); setDone(true); setPin(""); })}>Save PIN</Button>
      </div>
    </Modal>
  );
}
