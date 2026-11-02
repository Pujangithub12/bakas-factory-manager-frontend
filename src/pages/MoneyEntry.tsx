import { useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { Badge, Button, PageHeader, Table, Td } from "../components/ui";
import { BillModal, PaymentModal } from "../components/MoneyForms";
import { DAY, kgFmt } from "../lib/util";
import { billOf, rkg, rs2, saleAmt, vatOf } from "../shared/money";
import { num, ticketNet } from "../shared/rules";
import { fmtDateTime, type Row } from "../shared/time";

/** Bills and payments, entered from the printed books. A Manager sees and changes only his own entries of the last 7 days. */
export default function MoneyEntry() {
  const { D, reload } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const [bill, setBill] = useState<Row | null>(null);
  const [pay, setPay] = useState<{ dir: "paid" | "received"; payment?: Row } | null>(null);
  const since = Date.now() - 7 * DAY;
  const matName = (id: string) => D.material.find((m) => m.id === id)?.name ?? "-";
  const buyerName = (id: string) => D.buyer.find((b) => b.id === id)?.name ?? "-";

  const toBill = D.weigh_ticket.filter((t) => t.direction === "out" && t.second_kg != null && !billOf(D, t.id) && Date.now() - new Date(t.second_at).getTime() < 30 * DAY).sort((a, b) => b.second_at.localeCompare(a.second_at));
  const myBills = D.sales_bill.filter((b) => b.entered_by === me && new Date(b.entered_at).getTime() >= since);
  const myPays = D.payment.filter((p) => p.entered_by === me && new Date(p.entered_at).getTime() >= since);
  const entries = [
    ...myBills.map((b) => ({ k: "bill" as const, at: b.entered_at as string, b })),
    ...myPays.map((p) => ({ k: "pay" as const, at: p.entered_at as string, p })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div>
      <PageHeader title="Money entry" sub="Enter bills and payments from the books. You can change your own entries for 7 days. Totals and balances are for the Owner.">
        <Button onClick={() => setPay({ dir: "paid" })}>Payment to a supplier</Button>
        <Button onClick={() => setPay({ dir: "received" })}>Money received from a buyer</Button>
      </PageHeader>

      <h2 className="mb-2 font-semibold">Sales trucks without a bill entry</h2>
      <p className="mb-2 text-sm text-slate-500">Last 30 days. The bill no. is normally the challan no.</p>
      <Table head={["Out", "Challan", "Buyer", "Product", "Net (kg)", "Buyer's P.O.", ""]} empty="Every sales truck has its bill entered.">
        {toBill.map((t) => (
          <tr key={t.id}>
            <Td>{fmtDateTime(t.second_at)}</Td><Td>{t.challan_no}</Td><Td>{buyerName(t.buyer_id)}</Td><Td>{matName(t.material_id)}</Td>
            <Td>{kgFmt(ticketNet(t))}</Td><Td>{t.po_no ?? "-"}</Td><Td><Button small onClick={() => setBill(t)}>Enter bill</Button></Td>
          </tr>
        ))}
      </Table>

      <h2 className="mb-2 mt-6 font-semibold">Your entries, last 7 days</h2>
      <Table head={["Entered", "What", "Party", "No. / ref.", "Amount", "Can change until", ""]} empty="Nothing entered in the last 7 days.">
        {entries.map((e) => {
          const until = new Date(new Date(e.at).getTime() + 7 * DAY).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
          if (e.k === "bill") {
            const t = D.weigh_ticket.find((x) => x.id === e.b.ticket_id);
            return (
              <tr key={e.b.id}>
                <Td>{fmtDateTime(e.at)}</Td>
                <Td>Bill · {t ? `${matName(t.material_id)} ${kgFmt(ticketNet(t))} kg x ${rkg(num(e.b.rate))}` : ""} · {e.b.payment_mode} <Badge>{e.b.bill_no}</Badge></Td>
                <Td>{t ? buyerName(t.buyer_id) : ""}</Td><Td>{e.b.bill_no}</Td><Td>{t ? rs2(saleAmt(D, t) + vatOf(D, t)) : ""}</Td><Td>{until}</Td>
                <Td>{t ? <Button small kind="ghost" onClick={() => setBill(t)}>Change</Button> : null}</Td>
              </tr>
            );
          }
          const p = e.p;
          const party = (p.direction === "paid" ? D.supplier : D.buyer).find((x) => x.id === (p.supplier_id ?? p.buyer_id))?.name ?? "";
          return (
            <tr key={p.id}>
              <Td>{fmtDateTime(e.at)}</Td><Td>{p.direction === "paid" ? "Paid to supplier" : "Received from buyer"} · {p.mode}</Td><Td>{party}</Td><Td>{p.ref ?? "-"}</Td>
              <Td>{rs2(num(p.amount))}</Td><Td>{until}</Td><Td><Button small kind="ghost" onClick={() => setPay({ dir: p.direction, payment: p })}>Change</Button></Td>
            </tr>
          );
        })}
      </Table>

      {bill ? <BillModal ticket={bill} onClose={() => setBill(null)} onSaved={reload} /> : null}
      {pay ? <PaymentModal dir={pay.dir} payment={pay.payment} onClose={() => setPay(null)} onSaved={reload} /> : null}
    </div>
  );
}
