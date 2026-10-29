import { useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { api, newId, push } from "../lib/api";
import { Badge, Button, Check, ErrorText, Field, Modal, PageHeader, Select, Table, Td, useRun } from "../components/ui";
import { cls, inputToIso, isoToInput } from "../lib/util";
import { rolesOf } from "../shared/rules";
import type { Row } from "../shared/time";

type FieldDef = { key: string; label: string; kind: "text" | "number" | "bool" | "select" | "time" | "datetime"; options?: string[]; required?: boolean; hint?: string };
type Entity = { key: string; title: string; table: string; fields: FieldDef[]; columns: string[]; blank?: Row };

const STAGES = ["chip", "wetmill", "dry", "briquette", "mill", "pellet", "sharpen"];

const ENTITIES: Entity[] = [
  {
    key: "machines", title: "Machines", table: "machine", columns: ["tag", "name", "stage", "make_model", "hour_meter_start"],
    fields: [
      { key: "tag", label: "Tag (e.g. PM-01)", kind: "text", required: true },
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "make_model", label: "Make and model", kind: "text" },
      { key: "stage", label: "Stage", kind: "select", options: STAGES, required: true },
      { key: "rated_capacity", label: "Rated capacity (maker's figure only)", kind: "text", hint: "Output is never worked out from this." },
      { key: "motor_kw", label: "Motor (kW)", kind: "number" },
      { key: "hour_meter_start", label: "Hour meter when records start", kind: "number" },
      { key: "hour_meter_start_at", label: "Hour meter read at", kind: "datetime" },
      { key: "wear_part", label: "Wear part (e.g. Briquette die set)", kind: "text" },
      { key: "wear_limit_t", label: "Change after (tons)", kind: "number" },
      { key: "notes", label: "Notes", kind: "text" },
    ],
  },
  {
    key: "shifts", title: "Shifts", table: "shift", columns: ["name", "starts", "ends"],
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "starts", label: "Starts", kind: "time", required: true },
      { key: "ends", label: "Ends", kind: "time", required: true },
    ],
  },
  {
    key: "yards", title: "Yards", table: "yard", columns: ["name", "letter", "holds_trucks"],
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "letter", label: "Letter (used in batch codes)", kind: "text", required: true },
      { key: "holds_trucks", label: "Holds (trucks)", kind: "number", hint: "The yard closes for filling at this many trucks." },
    ],
  },
  {
    key: "materials", title: "Materials", table: "material", columns: ["name", "kind", "feed_stage", "bag_kg"],
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "kind", label: "Kind", kind: "select", options: ["Raw", "Finished product"], required: true },
      { key: "feed_stage", label: "First machine (raw material)", kind: "select", options: ["chip", "wetmill", "dry"] },
      { key: "bag_kg", label: "kg per bag (pellets)", kind: "number" },
      { key: "notes", label: "Notes", kind: "text" },
    ],
  },
  {
    key: "suppliers", title: "Suppliers", table: "supplier", columns: ["name", "phone", "pan", "usually_supplies"],
    fields: [
      { key: "name", label: "Name", kind: "text", required: true }, { key: "phone", label: "Phone", kind: "text" }, { key: "address", label: "Address", kind: "text" },
      { key: "pan", label: "PAN", kind: "text" }, { key: "usually_supplies", label: "Usually supplies", kind: "text" },
    ],
  },
  {
    key: "buyers", title: "Buyers", table: "buyer", columns: ["name", "phone", "pan_vat", "products"],
    fields: [
      { key: "name", label: "Name", kind: "text", required: true }, { key: "phone", label: "Phone", kind: "text" }, { key: "address", label: "Address", kind: "text" },
      { key: "pan_vat", label: "PAN / VAT (goes on the bill)", kind: "text" }, { key: "products", label: "Products", kind: "text" },
    ],
  },
  {
    key: "stop", title: "Stop reasons", table: "stop_reason", columns: ["name", "type", "machine_down", "calls_maintenance"],
    fields: [
      { key: "name", label: "Name", kind: "text", required: true },
      { key: "type", label: "Type", kind: "select", options: ["Planned", "Unplanned"], required: true },
      { key: "machine_down", label: "Machine is down (counts downtime)", kind: "bool" },
      { key: "calls_maintenance", label: "Calls maintenance (opens a job, blocks restart until fixed)", kind: "bool" },
    ],
  },
  {
    key: "fields", title: "Log sheet lines", table: "log_field", columns: ["stage", "kind", "label", "field_key", "unit", "required", "sort"],
    fields: [
      { key: "stage", label: "Machine stage", kind: "select", options: ["pellet", "briquette", "dry"], required: true },
      { key: "kind", label: "Kind", kind: "select", options: ["reading", "prestart", "greasing"], required: true },
      { key: "field_key", label: "Key (e.g. svLoad)", kind: "text", required: true },
      { key: "label", label: "Label as on the paper sheet", kind: "text", required: true },
      { key: "unit", label: "Unit", kind: "text" },
      { key: "required", label: "Required every time", kind: "bool" },
      { key: "sort", label: "Order", kind: "number" },
    ],
  },
];

const timeText = (v: string) => { const d = new Date(v); return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };

export default function Setup() {
  const [tab, setTab] = useState("machines");
  return (
    <div>
      <PageHeader title="Setup lists" sub="The lists every form picks from. Nothing is deleted. People and roles are on the Users & roles page." />
      <div className="mb-4 flex flex-wrap gap-1 border-b border-slate-200">
        {ENTITIES.map((e) => (
          <button key={e.key} onClick={() => setTab(e.key)} className={cls("-mb-px border-b-2 px-3 py-2 text-sm font-semibold", tab === e.key ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800")}>{e.title}</button>
        ))}
      </div>
      <ListEditor key={tab} entity={ENTITIES.find((e) => e.key === tab)!} />
    </div>
  );
}

function show(f: FieldDef, v: unknown) {
  if (v == null || v === "") return "-";
  if (f.kind === "bool") return v ? <Badge tone="good">Yes</Badge> : "No";
  if (f.kind === "time") return timeText(String(v));
  if (f.kind === "datetime") return isoToInput(String(v)).replace("T", " ");
  return String(v);
}

function ListEditor({ entity }: { entity: Entity }) {
  const { D, reload } = useData();
  const rows = (D[entity.table] ?? []) as Row[];
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const cols = entity.columns.map((c) => entity.fields.find((f) => f.key === c)!);
  const sorted = [...rows].sort((a, b) => String(a[entity.columns[0]]).localeCompare(String(b[entity.columns[0]])));

  return (
    <div>
      <div className="mb-3 flex justify-end"><Button onClick={() => setEditing("new")}>Add</Button></div>
      <Table head={[...cols.map((c) => c.label.replace(/ \(.*\)/, "")), ""]} empty="Nothing here yet.">
        {sorted.map((r) => (
          <tr key={r.id}>
            {cols.map((f, i) => <Td key={f.key} className={i === 0 ? "font-semibold" : ""}>{show(f, r[f.key])}</Td>)}
            <Td><Button small kind="ghost" onClick={() => setEditing(r)}>Edit</Button></Td>
          </tr>
        ))}
      </Table>
      {editing ? <RowEditor entity={entity} row={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={reload} /> : null}
    </div>
  );
}

function RowEditor({ entity, row, onClose, onSaved }: { entity: Entity; row: Row | null; onClose: () => void; onSaved: () => void }) {
  const init = (f: FieldDef): string | boolean => {
    const v = row?.[f.key];
    if (f.kind === "bool") return v == null ? false : !!v;
    if (v == null) return "";
    if (f.kind === "time") return timeText(String(v));
    if (f.kind === "datetime") return isoToInput(String(v));
    return String(v);
  };
  const [vals, setVals] = useState<Record<string, string | boolean>>(Object.fromEntries(entity.fields.map((f) => [f.key, init(f)])));
  const { busy, error, run } = useRun(onSaved);

  const save = () =>
    run(async () => {
      const data: Row = { id: row?.id ?? newId() };
      for (const f of entity.fields) {
        const v = vals[f.key];
        if (f.kind === "bool") { data[f.key] = !!v; continue; }
        const s = String(v).trim();
        if (!s) { if (f.required) throw new Error(`${f.label} is required`); data[f.key] = null; continue; }
        if (f.kind === "number") { if (isNaN(Number(s))) throw new Error(`${f.label} must be a number`); data[f.key] = Number(s); }
        else if (f.kind === "time") { if (!/^\d{2}:\d{2}$/.test(s)) throw new Error(`${f.label}: use HH:MM`); data[f.key] = `1970-01-01T${s}:00.000Z`; }
        else if (f.kind === "datetime") data[f.key] = inputToIso(s);
        else data[f.key] = s;
      }
      if (entity.table === "yard") data.letter = String(data.letter).toUpperCase();
      await push([{ table: entity.table, data }], true);
      onClose();
    });

  return (
    <Modal title={`${row ? "Edit" : "Add"} · ${entity.title}`} onClose={onClose}>
      <div className="space-y-3">
        {entity.fields.map((f) =>
          f.kind === "bool" ? <Check key={f.key} label={f.label} value={!!vals[f.key]} onChange={(v) => setVals((x) => ({ ...x, [f.key]: v }))} />
          : f.kind === "select" ? <Select key={f.key} label={f.label} value={String(vals[f.key])} onChange={(v) => setVals((x) => ({ ...x, [f.key]: v }))} options={f.options!.map((o) => ({ value: o, label: o }))} />
          : <Field key={f.key} label={f.label} hint={f.hint} type={f.kind === "time" ? "time" : f.kind === "datetime" ? "datetime-local" : "text"} value={String(vals[f.key])} onChange={(v) => setVals((x) => ({ ...x, [f.key]: v }))} />
        )}
        <ErrorText text={error} />
        <div className="flex justify-end gap-2"><Button kind="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={save}>Save</Button></div>
      </div>
    </Modal>
  );
}
