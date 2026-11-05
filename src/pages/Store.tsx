import { useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { Button, Field, Modal, PageHeader, Select, Table, Td } from "../components/ui";
import { Fig, IssueDialog, ItemDialog, ReceiveDialog, ReturnDialog, qty } from "../components/StoreDialogs";
import { NewPRDialog } from "../components/PurchaseDialogs";
import { rs, rsK } from "../shared/money";
import { KINDS, itemName, num, outCount, personName, toolsOut } from "../shared/rules";
import { DAY, fmtDateTime, fmtTime, productionDayStart, type Row } from "../shared/time";

type Tab = "out" | "stock" | "log";
type Dlg = { k: "issue" | "receive" | "item" | "request"; id?: string } | { k: "return"; move: Row } | { k: "history"; id: string } | null;

/** Time, with the day added when it was before this production day began. */
const when = (v: unknown) => fmtTime(v) + (new Date(v as string) < productionDayStart() ? ` ${fmtDateTime(v).replace(/ \d\d:\d\d$/, "")}` : "");

/** What happened in a movement, in words. */
const moveText = (m: Row) =>
  m.type === "in" ? "Received" : m.due_back ? (m.returned_at ? `Out and back ${fmtTime(m.returned_at)}${m.condition && m.condition !== "OK" ? ` · ${m.condition}` : ""}` : "Out, not back") : "Used";

export default function Store() {
  const { D } = useData();
  const { session } = useAuth();
  const roles = session!.roles;
  const canStore = roles.some((r) => ["Store", "Owner", "Manager", "Supervisor"].includes(r));
  const money = roles.includes("Owner");
  const [tab, setTab] = useState<Tab>("out");
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [dlg, setDlg] = useState<Dlg>(null);
  const close = () => setDlg(null);

  const now = Date.now();
  const out = toolsOut(D).sort((a, b) => a.due_back.localeCompare(b.due_back));
  const late = out.filter((m) => now > new Date(m.due_back).getTime());
  const low = D.store_item.filter((i) => num(i.qty) < num(i.min_qty));
  const needle = q.trim().toLowerCase();
  const items = D.store_item
    .filter((i) => (!kind || i.kind === kind) && (!needle || `${i.name} ${i.code ?? ""}`.toLowerCase().includes(needle)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const moves = [...D.store_movement].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 120);
  const stockValue = D.store_item.reduce((s, i) => s + num(i.qty) * num(i.rate), 0);

  return (
    <div className="space-y-4">
      <PageHeader title="Store" sub="Tools and tackles go out to a person and come back checked. Spares, lubricants and consumables come off the stock." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fig label="Tools out now" value={out.length} />
        <Fig label="Not returned in time" value={late.length} alert={late.length > 0} />
        <Fig label="Below minimum" value={low.length} alert={low.length > 0} note={low.length ? "needs reordering" : "all stocked"} />
        {money ? <Fig label="Stock value" value={rsK(stockValue)} note="owner only" /> : null}
      </div>

      {canStore ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setDlg({ k: "issue" })}>Issue</Button>
          <Button kind="soft" onClick={() => setDlg({ k: "receive" })}>Receive stock</Button>
          <Button kind="soft" onClick={() => setDlg({ k: "item" })}>+ New item</Button>
        </div>
      ) : null}

      <div className="flex gap-1 border-b border-slate-200" role="tablist">
        {([["out", "Tools out"], ["stock", "Stock"], ["log", "Movements"]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? "border-brand-700 text-brand-800" : "border-transparent text-slate-500 hover:text-slate-800"}`}>{l}</button>
        ))}
      </div>

      {tab === "out" ? (
        <Table head={["Tool", "With", "Since", "Back by", "For", ""]} empty="All tools are in the store.">
          {out.map((m) => (
            <tr key={m.id}>
              <Td>{itemName(D, m.item_id)}{num(m.qty) > 1 ? ` × ${qty(m.qty)}` : ""}</Td>
              <Td>{personName(D, m.to_person_id)}</Td>
              <Td>{when(m.at)}</Td>
              <Td>{now > new Date(m.due_back).getTime() ? <span className="font-semibold text-red-700">{when(m.due_back)}, late</span> : when(m.due_back)}</Td>
              <Td className="max-w-xs whitespace-normal">{m.note ?? ""}</Td>
              <Td>{canStore ? <Button small onClick={() => setDlg({ k: "return", move: m })}>Return</Button> : null}</Td>
            </tr>
          ))}
        </Table>
      ) : null}

      {tab === "stock" ? (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Search" value={q} onChange={setQ} placeholder="Name or part number" />
            <Select label="Kind" value={kind} onChange={setKind} placeholder="Everything" options={KINDS.map(([k, l]) => ({ value: k, label: l }))} />
          </div>
          <Table head={["Code", "Item", "Kind", "In store", "Minimum", "Unit", "Location", ...(money ? ["Rate"] : []), ""]} empty="Nothing found.">
            {items.map((i) => {
              const o = i.kind === "Tool" ? outCount(D, i.id) : 0;
              return (
                <tr key={i.id}>
                  <Td className="font-mono text-xs">{i.code ?? ""}</Td>
                  <Td><button className="text-left font-semibold text-slate-900 hover:underline" onClick={() => setDlg({ k: "history", id: i.id })}>{i.name}</button></Td>
                  <Td>{i.kind}</Td>
                  <Td className="text-right">{num(i.qty) < num(i.min_qty) ? <span className="font-semibold text-red-700">{qty(i.qty)}</span> : qty(i.qty)}{o ? <span className="text-slate-500"> ({o} out)</span> : null}</Td>
                  <Td className="text-right">{qty(i.min_qty)}</Td>
                  <Td>{i.unit}</Td>
                  <Td>{i.location ?? ""}</Td>
                  {money ? <Td className="text-right">{i.rate != null ? rs(num(i.rate)) : "-"}</Td> : null}
                  <Td>
                    <div className="flex gap-2">
                      {canStore ? (
                        <>
                          <Button small onClick={() => setDlg({ k: "issue", id: i.id })}>Issue</Button>
                          <Button small kind="ghost" onClick={() => setDlg({ k: "receive", id: i.id })}>Receive</Button>
                          <Button small kind="ghost" onClick={() => setDlg({ k: "item", id: i.id })}>Edit</Button>
                        </>
                      ) : <Button small kind="ghost" onClick={() => setDlg({ k: "history", id: i.id })}>History</Button>}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </Table>
        </>
      ) : null}

      {tab === "log" ? (
        <Table head={["When", "Item", "Movement", "Qty", "Person", "By", "Note"]} empty="No movements yet.">
          {moves.map((m) => (
            <tr key={m.id}>
              <Td>{when(m.at)}</Td>
              <Td>{itemName(D, m.item_id)}</Td>
              <Td>{m.type === "in" ? <span className="font-semibold text-emerald-700">Received</span> : moveText(m)}</Td>
              <Td className="text-right">{qty(m.qty)}</Td>
              <Td>{m.to_person_id ? personName(D, m.to_person_id) : "-"}</Td>
              <Td>{personName(D, m.by)}</Td>
              <Td className="max-w-xs whitespace-normal">{m.note ?? ""}</Td>
            </tr>
          ))}
        </Table>
      ) : null}

      {dlg?.k === "issue" ? <IssueDialog itemId={dlg.id} onClose={close} /> : null}
      {dlg?.k === "return" ? <ReturnDialog move={dlg.move} onClose={close} /> : null}
      {dlg?.k === "receive" ? <ReceiveDialog itemId={dlg.id} onClose={close} /> : null}
      {dlg?.k === "item" ? <ItemDialog itemId={dlg.id} onClose={close} /> : null}
      {dlg?.k === "request" ? <NewPRDialog itemId={dlg.id} onClose={close} /> : null}
      {dlg?.k === "history" ? <ItemHistory id={dlg.id} canStore={canStore} onIssue={() => setDlg({ k: "issue", id: dlg.id })} onRequest={() => setDlg({ k: "request", id: dlg.id })} onClose={close} /> : null}
    </div>
  );
}

/** One item: stock figures and every movement. */
function ItemHistory({ id, canStore, onIssue, onRequest, onClose }: { id: string; canStore: boolean; onIssue: () => void; onRequest: () => void; onClose: () => void }) {
  const { D } = useData();
  const it = D.store_item.find((i) => i.id === id);
  if (!it) return null;
  const mv = D.store_movement.filter((m) => m.item_id === id).sort((a, b) => b.at.localeCompare(a.at));
  const below = num(it.qty) < num(it.min_qty);
  const tool = it.kind === "Tool";
  const used30 = mv.filter((m) => m.type === "issue" && new Date(m.at).getTime() >= Date.now() - 30 * DAY).reduce((s, m) => s + num(m.qty), 0);
  return (
    <Modal title={it.name} onClose={onClose} wide>
      <p className="mb-3 text-sm text-slate-500">{[it.kind, it.code, it.location].filter(Boolean).join(" · ")}</p>
      <div className="grid grid-cols-3 gap-3">
        <Fig label={`${it.unit} in store`} value={qty(it.qty)} alert={below} />
        <Fig label="Minimum" value={qty(it.min_qty)} />
        <Fig label={tool ? "Out now" : "Used in 30 days"} value={qty(tool ? outCount(D, it.id) : used30)} />
      </div>
      {canStore ? (
        <div className="mt-3 flex gap-2">
          <Button kind="soft" onClick={onIssue}>Issue</Button>
          {below ? <Button onClick={onRequest}>Request more</Button> : null}
        </div>
      ) : null}
      <h3 className="mb-2 mt-4 font-semibold">Movements</h3>
      {mv.length === 0 ? <p className="text-sm text-slate-500">No movements.</p> : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {mv.map((m) => (
            <li key={m.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
              <div>
                <div className="font-semibold">{fmtDateTime(m.at)}</div>
                <div>{m.type === "in" ? "Received" : m.due_back ? (m.returned_at ? `Out and back${m.condition && m.condition !== "OK" ? ` · ${m.condition}` : ""}` : "Out, not back") : "Used"}{m.to_person_id ? ` · ${personName(D, m.to_person_id)}` : ""}</div>
                {m.note ? <small className="text-slate-500">{m.note}</small> : null}
              </div>
              <span className="whitespace-nowrap font-semibold">{qty(m.qty)} {it.unit}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
