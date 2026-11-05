import { useEffect, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { api, newId, push } from "../lib/api";
import { Badge, Button, Card, Check, ErrorText, Field, Modal, PageHeader, Table, Td, useRun } from "../components/ui";
import { ROLE_BLURB, ROLE_LIST, canManage, grantableRoles, rank } from "../lib/roles";
import { rolesOf } from "../shared/rules";
import type { Row } from "../shared/time";

const roleTone = (r: string) => (r === "Owner" ? "bad" : r === "Manager" ? "warn" : r === "Supervisor" ? "info" : "mute") as "bad" | "warn" | "info" | "mute";

/** Users and roles. The Owner gives admin (Manager) access; the Owner and admins add and remove users and give roles. */
export default function Users() {
  const { D, reload } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const myRoles = session!.roles;
  const isOwner = myRoles.includes("Owner");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [pinFor, setPinFor] = useState<Row | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const { busy, error, run } = useRun(reload);

  const list = D.person
    .filter((p) => showRemoved || p.active)
    .sort((a, b) => rank(rolesOf(D, b.id)) - rank(rolesOf(D, a.id)) || a.full_name.localeCompare(b.full_name));
  const admins = D.person.filter((p) => p.active && rolesOf(D, p.id).includes("Manager")).length;

  return (
    <div>
      <PageHeader title="Users & roles" sub="Add and remove users, give them roles, and the screens they see follow their roles. A user can have several roles.">
        <Button onClick={() => setEditing("new")}>Add user</Button>
      </PageHeader>

      <Card className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <span><b>Owner</b> is the super admin: there is one, and the role cannot be given or taken away.</span>
        <span><b>Manager</b> is the admin ({admins} now). {isOwner ? "You give and remove admin access below." : "Only the Owner can give or remove it."}</span>
      </Card>

      <div className="mb-3 flex items-center justify-between">
        <Check label="Show removed users" value={showRemoved} onChange={setShowRemoved} />
        <ErrorText text={error} />
      </div>

      <Table head={["Name", "Mobile", "Roles", "Status", ""]} empty="No users yet.">
        {list.map((p) => {
          const roles = rolesOf(D, p.id);
          const mine = p.id === me;
          const manage = canManage(me, myRoles, p.id, roles);
          const isOwnerRow = roles.includes("Owner");
          return (
            <tr key={p.id} className={p.active ? "" : "opacity-60"}>
              <Td className="font-semibold">{p.full_name}{mine ? <span className="ml-2 text-xs font-normal text-slate-500">(you)</span> : null}</Td>
              <Td>{p.mobile ?? "-"}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {roles.length === 0 ? <span className="text-slate-400">No role</span> : roles.map((r) => <Badge key={r} tone={roleTone(r)}>{r === "Manager" ? "Manager · admin" : r === "Owner" ? "Owner · super admin" : r}</Badge>)}
                </div>
              </Td>
              <Td>{p.active ? <Badge tone="good">Active</Badge> : <Badge>Removed</Badge>}</Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  <Button small kind="ghost" onClick={() => setEditing(p)}>{manage ? "Edit" : "View"}</Button>
                  {manage ? <Button small kind="ghost" onClick={() => setPinFor(p)}>PIN</Button> : null}
                  {p.active && manage && !mine && !isOwnerRow ? (
                    <Button small kind="ghost" disabled={busy} onClick={() => { if (window.confirm(`Remove ${p.full_name}? They can no longer sign in, and their old records stay.`)) run(() => push([{ table: "person", data: { id: p.id, active: false } }], true)); }}>Remove</Button>
                  ) : null}
                  {!p.active && manage ? <Button small kind="soft" disabled={busy} onClick={() => run(() => push([{ table: "person", data: { id: p.id, active: true } }], true))}>Restore</Button> : null}
                </div>
              </Td>
            </tr>
          );
        })}
      </Table>

      {editing ? <UserEditor person={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
      {pinFor ? <PinModal person={pinFor} onClose={() => setPinFor(null)} /> : null}
    </div>
  );
}

function UserEditor({ person, onClose, onSaved }: { person: Row | null; onClose: () => void; onSaved: () => void }) {
  const { D } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const myRoles = session!.roles;
  const had = person ? rolesOf(D, person.id) : [];
  const canEditPerson = !person || canManage(me, myRoles, person.id, had);
  const grantable = grantableRoles(myRoles);
  const [f, setF] = useState({ name: person?.full_name ?? "", mobile: person?.mobile ?? "", address: person?.address ?? "", idNo: person?.id_no ?? "" });
  // The email used to reset the PIN. It is not in the synced data, so it is asked for separately.
  const [email, setEmail] = useState("");
  const [email0, setEmail0] = useState("");
  useEffect(() => {
    if (!person) return;
    api<{ id: string; email: string }[]>("/people/emails").then((rows) => {
      const e = rows.find((x) => x.id === person.id)?.email ?? "";
      setEmail(e);
      setEmail0(e);
    }).catch(() => {});
  }, [person?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [roles, setRoles] = useState<string[]>(had);
  const [pin, setPin] = useState("");
  const { busy, error, run } = useRun(onSaved);

  const save = () =>
    run(async () => {
      const name = f.name.trim().replace(/\s+/g, " ");
      if (!name) throw new Error("Enter the name");
      if (f.mobile && !/^\d{10}$/.test(f.mobile)) throw new Error("Mobile must be 10 digits, or leave it empty");
      if (!person && roles.length === 0) throw new Error("Give the user at least one role");
      if (pin && !/^\d{6}$/.test(pin)) throw new Error("PIN must be 6 digits");
      if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new Error("That does not look like an email address");
      const id = person?.id ?? newId();
      const now = new Date().toISOString();
      const ops: { table: string; op?: "upsert" | "delete"; data: Row }[] = [{
        table: "person",
        data: { id, full_name: name, mobile: f.mobile || null, address: f.address.trim() || null, id_no: f.idNo.trim() || null,
          ...(person ? {} : { active: true, checked: true, registered_by: me, registered_at: now, checked_by: me, checked_at: now }) },
      }];
      // Only the roles that changed, and only ones this person is allowed to change.
      for (const r of roles) if (!had.includes(r) && grantable.includes(r)) ops.push({ table: "person_role", data: { person_id: id, role: r, is_main: had.length === 0 && ops.length === 1 } });
      for (const r of had) if (!roles.includes(r) && grantable.includes(r)) ops.push({ table: "person_role", op: "delete", data: { person_id: id, role: r } });
      await push(ops, true);
      if (pin) await api(`/people/${id}/pin`, { body: { pin } });
      if (email.trim().toLowerCase() !== email0) await api(`/people/${id}/email`, { body: { email: email.trim().toLowerCase() } });
      onClose();
    });

  const toggle = (r: string, on: boolean) => setRoles((x) => (on ? [...x, r] : x.filter((y) => y !== r)));

  return (
    <Modal title={person ? (canEditPerson ? `Edit ${person.full_name}` : person.full_name) : "Add a user"} onClose={onClose} wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name as on the ID" value={f.name} onChange={(v) => setF((x) => ({ ...x, name: v }))} disabled={!canEditPerson} />
        <Field label="Mobile (10 digits)" hint="Optional." value={f.mobile} onChange={(v) => setF((x) => ({ ...x, mobile: v.replace(/\D/g, "").slice(0, 10) }))} disabled={!canEditPerson} />
        <Field label="Address" value={f.address} onChange={(v) => setF((x) => ({ ...x, address: v }))} disabled={!canEditPerson} />
        <Field label="ID no." value={f.idNo} onChange={(v) => setF((x) => ({ ...x, idNo: v }))} disabled={!canEditPerson} />
        <Field label="Email (for PIN reset)" value={email} onChange={setEmail} disabled={!canEditPerson} hint="Optional. Only used to email a PIN reset link." />
      </div>

      <div className="mt-4">
        <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Roles</span>
        <div className="grid gap-2 md:grid-cols-2">
          {ROLE_LIST.map((r) => {
            const allowed = grantable.includes(r) && canEditPerson;
            return (
              <div key={r} className={allowed ? "" : "opacity-60"}>
                <Check label={r === "Manager" ? "Manager (admin access)" : r === "Owner" ? "Owner (super admin)" : r} value={roles.includes(r)} onChange={(v) => allowed && toggle(r, v)} />
                <div className="ml-6 text-xs text-slate-500">
                  {ROLE_BLURB[r]}
                  {!allowed && r === "Owner" ? " · cannot be changed" : !allowed && r === "Manager" && !myRoles.includes("Owner") ? " · only the Owner can change this" : !allowed && r === "Supervisor" && !grantable.includes(r) ? " · only the Owner or an admin" : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {!person ? (
        <div className="mt-4 max-w-xs">
          <Field label="Sign-in PIN (6 digits)" type="password" value={pin} onChange={(v) => setPin(v.replace(/\D/g, "").slice(0, 6))} hint="Without a PIN the user cannot sign in yet. You can set it later." />
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>{canEditPerson ? "Cancel" : "Close"}</Button>
          {canEditPerson ? <Button disabled={busy} onClick={save}>Save</Button> : null}
        </div>
      </div>
    </Modal>
  );
}

function PinModal({ person, onClose }: { person: Row; onClose: () => void }) {
  const [pin, setPin] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run } = useRun();
  return (
    <Modal title={`PIN for ${person.full_name}`} onClose={onClose}>
      <Field label="New 6-digit PIN" type="password" value={pin} onChange={(v) => { setPin(v.replace(/\D/g, "").slice(0, 6)); setDone(false); }} />
      {done ? <p className="mt-2 text-sm text-emerald-700">PIN set.</p> : null}
      <div className="mt-3"><ErrorText text={error} /></div>
      <div className="mt-4 flex justify-end gap-2">
        <Button kind="ghost" onClick={onClose}>Close</Button>
        <Button disabled={busy || pin.length !== 6} onClick={() => run(async () => { await api(`/people/${person.id}/pin`, { body: { pin } }); setDone(true); setPin(""); })}>Save PIN</Button>
      </div>
    </Modal>
  );
}
