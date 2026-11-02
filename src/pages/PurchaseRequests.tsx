import { useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { push } from "../lib/api";
import { Badge, Button, ErrorText, Modal, PageHeader, Table, Td, useRun } from "../components/ui";
import { Fig, ReceiveDialog } from "../components/StoreDialogs";
import { NewPRDialog, OrderDialog, RejectDialog, dLab, dateLab } from "../components/PurchaseDialogs";
import { rs } from "../shared/money";
import { PR_TONE, itemName, num, personName, prLines, prText } from "../shared/rules";
import { fmtTime, nowIso, type Row } from "../shared/time";

type Dlg = { k: "new" } | { k: "order" | "reject" | "receive" | "detail"; id: string } | null;

export default function PurchaseRequests() {
  const { D, reload } = useData();
  const { session } = useAuth();
  const roles = session!.roles;
  const me = session!.person.id;
  const money = roles.includes("Owner");
  const canApprove = roles.some((r) => r === "Owner" || r === "Manager");
  const canStore = roles.some((r) => ["Store", "Owner", "Manager", "Supervisor"].includes(r));
  const [dlg, setDlg] = useState<Dlg>(null);
  const { busy, error, run } = useRun(reload);
  const close = () => setDlg(null);

  const list = [...D.purchase_request].sort((a, b) => b.requested_at.localeCompare(a.requested_at));
  const cnt = (s: string) => list.filter((p) => p.status === s).length;
  const pr = (id: string) => D.purchase_request.find((p) => p.id === id);

  const approve = (p: Row) => run(() => push([{ table: "purchase_request", data: { id: p.id, status: "Approved", approved_by: me, approved_at: nowIso() } }]));
  /** With a store item on the request the stock goes up through the receive dialog; otherwise just the status moves. */
  const received = (p: Row) => {
    if (prLines(D, p.id).some((l) => l.item_id)) setDlg({ k: "receive", id: p.id });
    else run(() => push([{ table: "purchase_request", data: { id: p.id, status: "Received", received_by: me, received_at: nowIso() } }]));
  };

  const acts = (p: Row) => {
    const b = (label: string, onClick: () => void, kind?: "primary" | "ghost") => <Button small kind={kind} disabled={busy} onClick={onClick}>{label}</Button>;
    if (p.status === "Requested") return canApprove ? <>{b("Approve", () => approve(p), "primary")}{b("Reject", () => setDlg({ k: "reject", id: p.id }), "ghost")}</> : null;
    if (p.status === "Approved") return canStore ? b("Mark ordered", () => setDlg({ k: "order", id: p.id })) : null;
    if (p.status === "Ordered") return canStore ? b("Mark received", () => received(p)) : null;
    return null;
  };

  const detail = dlg?.k === "detail" ? pr(dlg.id) : undefined;

  return (
    <div className="space-y-4">
      <PageHeader title="Purchase requests" sub="Anyone can ask for something the factory needs. The owner or manager approves, the store orders and receives it." />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fig label="Waiting for approval" value={cnt("Requested")} alert={cnt("Requested") > 0} />
        <Fig label="Approved, to order" value={cnt("Approved")} />
        <Fig label="Ordered, to receive" value={cnt("Ordered")} />
        <Fig label="Received" value={cnt("Received")} />
      </div>

      <div><Button onClick={() => setDlg({ k: "new" })}>+ New request</Button></div>
      <ErrorText text={error} />

      <Table head={["No.", "Date", "By", "What", "Need by", "Status", ...(money ? ["Amount"] : []), ""]} empty="No requests yet.">
        {list.map((p) => (
          <tr key={p.id} className="cursor-pointer hover:bg-slate-50" tabIndex={0} onClick={() => setDlg({ k: "detail", id: p.id })}
            onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) setDlg({ k: "detail", id: p.id }); }}>
            <Td className="font-mono text-xs">{p.pr_no}</Td>
            <Td>{dLab(p.requested_at)}</Td>
            <Td>{personName(D, p.requested_by)}</Td>
            <Td className="max-w-md whitespace-normal">{prText(D, p)}{p.priority === "Urgent" ? <> <Badge tone="bad">Urgent</Badge></> : null}</Td>
            <Td>{p.need_by ? dateLab(p.need_by) : "-"}</Td>
            <Td><Badge tone={PR_TONE[p.status]}>{p.status}</Badge></Td>
            {money ? <Td className="text-right">{p.amount ? rs(num(p.amount)) : "-"}</Td> : null}
            <Td><div className="flex gap-2" onClick={(e) => e.stopPropagation()}>{acts(p)}</div></Td>
          </tr>
        ))}
      </Table>

      {dlg?.k === "new" ? <NewPRDialog onClose={close} /> : null}
      {dlg?.k === "order" && pr(dlg.id) ? <OrderDialog pr={pr(dlg.id)!} onClose={close} /> : null}
      {dlg?.k === "reject" && pr(dlg.id) ? <RejectDialog pr={pr(dlg.id)!} onClose={close} /> : null}
      {dlg?.k === "receive" ? <ReceiveDialog prId={dlg.id} onClose={close} /> : null}
      {detail ? (
        <Modal title={detail.pr_no} onClose={close}>
          <p className="mb-3 text-sm text-slate-500">{detail.reason}{detail.priority === "Urgent" ? " · urgent" : ""}</p>
          <div className="flex items-center gap-2">
            <Badge tone={PR_TONE[detail.status]}>{detail.status}</Badge>
            {detail.status === "Rejected" ? <span className="text-sm text-slate-500">{detail.reject_reason ?? ""}</span> : null}
          </div>
          <h3 className="mb-2 mt-4 font-semibold">Items</h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {prLines(D, detail.id).map((l) => (
              <li key={l.id} className="flex justify-between gap-3 px-3 py-2 text-sm"><span>{l.description || itemName(D, l.item_id)}</span><span className="whitespace-nowrap font-semibold">{num(l.qty)} {l.unit ?? ""}</span></li>
            ))}
          </ul>
          <h3 className="mb-2 mt-4 font-semibold">Steps</h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {([["Requested", detail.requested_at, detail.requested_by], ["Approved", detail.approved_at, detail.approved_by], ["Ordered", detail.ordered_at, detail.ordered_by], ["Received", detail.received_at, detail.received_by]] as [string, string | null, string | null][]).map(([l, t, b]) => (
              <li key={l} className="flex justify-between gap-3 px-3 py-2 text-sm">
                <span><span className="inline-block w-16 font-semibold">{t ? dLab(t) : "-"}</span> {l}{b ? ` · ${personName(D, b)}` : ""}</span>
                <span className="text-slate-500">{t ? fmtTime(t) : ""}</span>
              </li>
            ))}
          </ul>
          {detail.vendor ? <p className="mt-3 text-sm">Supplier: {detail.vendor}{money && detail.amount ? ` · ${rs(num(detail.amount))}` : ""}</p> : null}
          <div className="mt-3 flex gap-2">{acts(detail)}</div>
        </Modal>
      ) : null}
    </div>
  );
}
