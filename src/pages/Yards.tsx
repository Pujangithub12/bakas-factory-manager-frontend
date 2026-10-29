import { useEffect, useMemo, useState } from "react";
import { useData } from "../lib/data";
import { Badge, Card, Modal, PageHeader, Select, Table, Td } from "../components/ui";
import { DAY, kgFmt, tonFmt } from "../lib/util";
import { batchCode, batchMaterial, batchTickets, briquetteKg, num, personName, sumNet, ticketNet } from "../shared/rules";
import type { Data } from "../shared/types";
import { fmtDateTime, HOUR, type Row } from "../shared/time";

const LAG = 2 * HOUR; // output shows up about two hours after the raw material is fed in
const ms = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0);

/** Pellets spread evenly over the time each bag count covers (so an hour can be cut out of it). */
function pelletKgSpread(D: Data, from: number, to: number) {
  let kg = 0;
  for (const b of D.bag_count) {
    const a = ms(b.period_from);
    const z = ms(b.period_to);
    if (z <= a) continue;
    const o = Math.max(0, Math.min(z, to) - Math.max(a, from));
    kg += (o / (z - a)) * num(b.bags) * num(b.kg_per_bag);
  }
  return kg;
}

function machineRunMs(D: Data, stage: string | undefined, from: number, to: number, now: number) {
  if (!stage) return 0;
  const ids = new Set(D.machine.filter((m) => m.stage === stage).map((m) => m.id));
  return D.machine_run.filter((r) => ids.has(r.machine_id)).reduce((n, r) => {
    const s = ms(r.started_at);
    const e = r.stopped_at ? ms(r.stopped_at) : now;
    return n + Math.max(0, Math.min(e, to) - Math.max(s, from));
  }, 0);
}

type Out = { pellets: number; briquettes: number };

/** Output made while a batch was feeding, split across the batches feeding at the time. */
function outputs(D: Data, now: number): Map<string, Out> {
  const res = new Map<string, Out>();
  const batches = D.yard_batch.filter((b) => b.started_at);
  if (!batches.length) return res;
  const span = new Map(batches.map((b) => [b.id as string, [ms(b.started_at) + LAG, (b.finished_at ? ms(b.finished_at) : now) + LAG] as const]));
  for (const b of batches) res.set(b.id, { pellets: 0, briquettes: 0 });
  const first = Math.min(...[...span.values()].map((s) => s[0]));
  const last = Math.min(Math.max(...[...span.values()].map((s) => s[1])), now);
  for (let t = Math.floor(first / HOUR) * HOUR; t < last; t += HOUR) {
    const e = t + HOUR;
    const feeding = batches.filter((b) => { const [s, z] = span.get(b.id)!; return s < e && z > t; });
    if (!feeding.length) continue;
    const pel = pelletKgSpread(D, t, e) / feeding.length;
    const bri = briquetteKg(D, new Date(t), new Date(e), undefined, new Date(now)) / feeding.length;
    for (const b of feeding) { const o = res.get(b.id)!; o.pellets += pel; o.briquettes += bri; }
  }
  return res;
}

export default function Yards() {
  const { D, needDays } = useData();
  const [days, setDays] = useState("30");
  const [open, setOpen] = useState<Row | null>(null);
  useEffect(() => needDays(Number(days) + 2), [days, needDays]);
  const now = Date.now();

  const out = useMemo(() => outputs(D, Date.now()), [D]);

  // Tons per hour the entry machines handled in earlier, finished batches.
  const tph = useMemo(() => {
    const byStage = new Map<string, { kg: number; ms: number }>();
    for (const b of D.yard_batch.filter((x) => x.started_at && x.finished_at)) {
      const stage = batchMaterial(D, b)?.feed_stage;
      if (!stage) continue;
      const run = machineRunMs(D, stage, ms(b.started_at), ms(b.finished_at), Date.now());
      const cur = byStage.get(stage) ?? { kg: 0, ms: 0 };
      byStage.set(stage, { kg: cur.kg + sumNet(batchTickets(D, b.id)), ms: cur.ms + run });
    }
    return byStage;
  }, [D]);

  const rows = D.yard_batch
    .filter((b) => ms(b.opened_at) >= now - Number(days) * DAY || !b.finished_at)
    .sort((a, b) => b.opened_at.localeCompare(a.opened_at));

  const info = (b: Row) => {
    const tickets = batchTickets(D, b.id);
    const done = tickets.filter((t) => t.second_kg != null);
    const raw = sumNet(done);
    const mat = batchMaterial(D, b);
    const moist = done.flatMap((t) => [t.moisture_1, t.moisture_2, t.moisture_3]).filter((v) => v != null).map(num);
    const state = b.finished_at ? "Empty" : b.started_at ? "Feeding" : b.closed_at ? "Closed" : "Filling";
    // How much is left: the entry machine's hours x tons per hour from earlier batches. Never below 1% until marked empty.
    let left: string | null = null;
    if (state === "Feeding" || state === "Closed") {
      const h = tph.get(mat?.feed_stage ?? "");
      if (state === "Closed") left = "100%";
      else if (h && h.ms > 0 && raw > 0) {
        const used = ((h.kg / (h.ms / HOUR)) * (machineRunMs(D, mat?.feed_stage, ms(b.started_at), Date.now(), Date.now()) / HOUR)) / raw;
        left = `${Math.max(1, Math.round((1 - Math.min(used, 0.99)) * 100))}%`;
      }
    }
    const o = out.get(b.id);
    const made = o ? o.pellets + o.briquettes : 0;
    return { tickets, raw, mat, moist: moist.length ? moist.reduce((a, c) => a + c, 0) / moist.length : null, state, left, o, yieldPct: raw > 0 && b.started_at && o ? (made / raw) * 100 : null };
  };

  return (
    <div>
      <PageHeader title="Yards & batches" sub="Each filling of a yard is a batch. Everything here is worked out from the weights, not stored.">
        <Select value={days} onChange={(v) => setDays(v || "30")} placeholder="Period" options={[{ value: "7", label: "Last 7 days" }, { value: "30", label: "Last 30 days" }, { value: "90", label: "Last 90 days" }]} />
      </PageHeader>

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        {[...D.yard].sort((a, b) => a.letter.localeCompare(b.letter)).map((y) => {
          const b = D.yard_batch.filter((x) => x.yard_id === y.id && !x.finished_at).sort((p, q) => num(q.seq) - num(p.seq))[0];
          const i = b ? info(b) : null;
          return (
            <Card key={y.id}>
              <div className="flex items-center justify-between"><span className="font-bold">{y.name}</span>{i ? <Badge tone={i.state === "Feeding" ? "info" : i.state === "Closed" ? "warn" : "good"}>{i.state}</Badge> : <Badge>Empty</Badge>}</div>
              {b && i ? (
                <>
                  <p className="mt-1 text-sm text-slate-600">{batchCode(D, b)} · {i.mat?.name ?? "no truck yet"}</p>
                  <p className="text-sm text-slate-600">{i.tickets.length}/{y.holds_trucks ?? "-"} trucks · {tonFmt(i.raw)} t</p>
                  {i.left ? (
                    <div className="mt-2">
                      <div className="mb-1 text-xs text-slate-500">About {i.left} left (estimate)</div>
                      <div className="h-2 rounded bg-slate-100"><div className="h-2 rounded bg-brand-700" style={{ width: i.left }} /></div>
                    </div>
                  ) : i.state === "Feeding" ? <p className="mt-2 text-xs text-slate-500">Estimate needs earlier finished batches.</p> : null}
                </>
              ) : null}
            </Card>
          );
        })}
      </div>

      <Table head={["Batch", "Material", "Trucks", "Raw in", "Avg moisture", "State", "Opened", "Fed from", "Emptied", "Left", "Pellets", "Briquettes", "Yield"]} empty="No batches in this period.">
        {rows.map((b) => {
          const i = info(b);
          return (
            <tr key={b.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(b)}>
              <Td className="font-semibold">{batchCode(D, b)}</Td><Td>{i.mat?.name ?? "-"}</Td><Td>{i.tickets.length}</Td><Td>{tonFmt(i.raw)} t</Td>
              <Td>{i.moist != null ? `${i.moist.toFixed(1)}%` : "-"}</Td>
              <Td><Badge tone={i.state === "Feeding" ? "info" : i.state === "Closed" ? "warn" : i.state === "Filling" ? "good" : "mute"}>{i.state}</Badge></Td>
              <Td>{fmtDateTime(b.opened_at)}</Td><Td>{b.started_at ? fmtDateTime(b.started_at) : "-"}</Td><Td>{b.finished_at ? fmtDateTime(b.finished_at) : "-"}</Td>
              <Td>{i.left ?? "-"}</Td>
              <Td>{i.o ? `${tonFmt(i.o.pellets)} t` : "-"}</Td><Td>{i.o ? `${tonFmt(i.o.briquettes)} t` : "-"}</Td>
              <Td className="font-semibold">{i.yieldPct != null ? `${i.yieldPct.toFixed(0)}%` : "-"}</Td>
            </tr>
          );
        })}
      </Table>
      <p className="mt-2 text-xs text-slate-500">Yield = pellets and briquettes made while the batch was feeding (2-hour lag, split across batches feeding at the same time) ÷ raw weight of its trucks. The "left" estimate never goes below 1% until the operator marks the yard empty.</p>

      {open ? (
        <Modal title={`${batchCode(D, open)} trucks`} onClose={() => setOpen(null)} wide>
          <Table head={["Serial", "Vehicle", "Supplier", "Gross", "Tare", "Net", "Moisture"]} empty="No trucks.">
            {batchTickets(D, open.id).map((t) => (
              <tr key={t.id}>
                <Td>#{t.wbsn}</Td><Td>{t.vehicle_no}</Td><Td>{D.supplier.find((s) => s.id === t.supplier_id)?.name ?? "-"}</Td>
                <Td>{kgFmt(num(t.first_kg))}</Td><Td>{t.second_kg != null ? kgFmt(num(t.second_kg)) : "-"}</Td><Td className="font-semibold">{kgFmt(ticketNet(t))}</Td>
                <Td>{[t.moisture_1, t.moisture_2, t.moisture_3].map((v) => (v == null ? "-" : num(v))).join(" / ")}</Td>
              </tr>
            ))}
          </Table>
          <p className="mt-3 text-xs text-slate-500">{open.started_by ? `Started by ${personName(D, open.started_by)}. ` : ""}{open.finished_by ? `Emptied by ${personName(D, open.finished_by)}.` : ""}</p>
        </Modal>
      ) : null}
    </div>
  );
}
