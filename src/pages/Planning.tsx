import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { push } from "../lib/api";
import { Button, Card, ErrorText, Field, Modal, PageHeader, Table, Td, useRun } from "../components/ui";
import { TaskRow, usePmDialogs } from "../components/PmParts";
import { cls, DAY } from "../lib/util";
import { avgYield, briquetteId, pelletId, priceRaw, rsK, targetsOf } from "../shared/money";
import { belowMin, num } from "../shared/rules";
import { buyMix, coverDays, dailyUse, finishedStock, monthSoFar, needToBuy, pctf, pmNext7, soldPerDay, tn, tnum, yardLeft } from "../shared/plan";
import { nowIso } from "../shared/time";

const Fig = ({ label, value, sub, alert }: { label: string; value: React.ReactNode; sub?: React.ReactNode; alert?: boolean }) => (
  <Card><div className="text-xs text-slate-500">{label}</div><div className={cls("font-display text-2xl font-bold", alert && "text-red-700")}>{value}</div>{sub ? <div className="text-xs text-slate-500">{sub}</div> : null}</Card>
);

/** Raw material cover, what to buy this week, production against target, finished goods and the maintenance coming up. */
export default function Planning() {
  const { D, needDays } = useData();
  const { session } = useAuth();
  const dlg = usePmDialogs();
  const [targets, setTargets] = useState(false);
  const owner = session!.roles.includes("Owner");
  const admin = owner || session!.roles.includes("Manager");

  const now = Date.now();
  // The yield and the truck mix look back 30 days; finished goods count from the opening stock.
  const stockDays = Math.max(0, ...D.opening_stock.map((o) => Math.ceil((now - new Date(o.as_of).getTime()) / DAY) + 2));
  useEffect(() => needDays(Math.max(35, stockDays)), [needDays, stockDays]);

  const T = targetsOf(D);
  const y = avgYield(D);
  const use = dailyUse(D, now);
  const left = yardLeft(D, now);
  const cov = coverDays(D, now);
  const need = needToBuy(D, now);
  const mix = buyMix(D, need, now);
  const mo = monthSoFar(D, now);
  const soonPm = pmNext7(D, now);
  const reorder = belowMin(D);
  const goods = [pelletId(D), briquetteId(D)].filter((p): p is string => !!p);

  return (
    <div>
      <PageHeader title="Planning" sub="Raw material cover, what to buy this week, production against target, stock and the maintenance coming up.">
        {admin ? <Button kind="ghost" onClick={() => setTargets(true)}>Change targets</Button> : null}
      </PageHeader>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Fig label="Raw material cover" value={cov != null ? `${tnum(cov, 1)} days` : "—"} alert={cov != null && cov < 3} sub={`${tn(left, 0)} in the yards · using ${tn(use, 0)} a day`} />
        <Fig label="Buy in the next 7 days" value={tn(need, 0)} sub={`to keep ${T.cover_days} days at target`} />
        <Fig label="Pellets this month" value={tn(mo.pellets_t, 0)} sub={`target ${tn(T.pellets_t * mo.days, 0)} so far (${T.pellets_t} t a day)`} />
        <Fig label="Briquettes this month" value={tn(mo.briquettes_t, 0)} sub={`target ${tn(T.briquettes_t * mo.days, 0)} so far (${T.briquettes_t} t a day)`} />
      </div>

      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">What to buy this week</h2>
          <p className="mb-3 text-sm text-slate-500">Split like the last 30 days of trucks. Yield used: {pctf(y)} of raw weight.</p>
          <Table head={["Material", "Share", "Tons", "Trucks", ...(owner ? ["About"] : [])]} empty="No raw material trucks in the last 30 days.">
            {mix.map((r) => (
              <tr key={r.material_id}>
                <Td>{D.material.find((m) => m.id === r.material_id)?.name ?? "?"}</Td>
                <Td className="text-right">{pctf(r.share)}</Td>
                <Td className="text-right">{tnum(r.tons, 0)}</Td>
                <Td className="text-right">{r.trucks}</Td>
                {owner ? <Td className="text-right">{rsK(r.tons * 1000 * priceRaw(D, r.material_id, null))}</Td> : null}
              </tr>
            ))}
          </Table>
        </Card>
        <Card>
          <h2 className="font-semibold">Finished goods</h2>
          <p className="mb-3 text-sm text-slate-500">Days of stock at last week’s sales rate.</p>
          {goods.map((p) => {
            const st = finishedStock(D, p, now);
            const sold = soldPerDay(D, p, now);
            return (
              <div key={p} className="border-t border-slate-100 py-2 first:border-t-0">
                <div className="flex items-baseline justify-between"><b>{D.material.find((m) => m.id === p)?.name}</b><span>{st ? `${tn(st.t)} in store` : "— in store"}</span></div>
                <small className="text-slate-500">Selling {tn(sold, 1)} a day · {!st ? "no opening stock set up" : sold > 0 ? `${tnum(st.t / sold, 1)} days of stock` : "no sales last week"}</small>
              </div>
            );
          })}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-start justify-between gap-2">
            <div><h2 className="font-semibold">Maintenance in the next 7 days</h2><p className="text-sm text-slate-500">From the hour meters and last week’s running hours.</p></div>
          </div>
          {soonPm.length ? (
            <>
              <div>{soonPm.slice(0, 8).map(({ t }) => <TaskRow key={t.id} t={t} compact onHistory={() => dlg.openTask(t.id)} />)}</div>
              {soonPm.length > 8 ? <small className="text-slate-500">and {soonPm.length - 8} more on the maintenance plan</small> : null}
            </>
          ) : <p className="py-6 text-center text-sm text-slate-500">Nothing due in the next 7 days.</p>}
        </Card>
        <Card>
          <div className="mb-3 flex items-start justify-between gap-2">
            <h2 className="font-semibold">Store items to reorder</h2>
            <Link to="/store"><Button small kind="ghost">Store</Button></Link>
          </div>
          {reorder.length ? reorder.map((i) => (
            <div key={i.id} className="flex items-center gap-3 border-t border-slate-100 py-2 text-sm first:border-t-0">
              <span className="w-20 shrink-0 text-xs text-slate-500">{i.code}</span>
              <span className="min-w-0 flex-1">{i.name}<small className="block text-slate-500">{num(i.qty)} {i.unit} in store, keep {num(i.min_qty)}</small></span>
            </div>
          )) : <p className="py-6 text-center text-sm text-slate-500">Everything is above its minimum.</p>}
        </Card>
      </div>
      {targets ? <TargetsModal onClose={() => setTargets(false)} /> : null}
      {dlg.node}
    </div>
  );
}

/** Daily pellet and briquette targets, kWh per ton and days of raw material to keep. Used on the dashboard, planning and electricity pages. */
function TargetsModal({ onClose }: { onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const T = targetsOf(D);
  const [f, setF] = useState({ p: String(T.pellets_t), b: String(T.briquettes_t), k: String(T.kwh_per_t), c: String(T.cover_days) });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v.replace(/[^\d.]/g, "") }));
  const { busy, error, run } = useRun(reload);
  const save = async () => {
    const ok = await run(async () => {
      const value = { pellets_t: Number(f.p) || 0, briquettes_t: Number(f.b) || 0, kwh_per_t: Number(f.k) || 0, cover_days: Number(f.c) || 7 };
      await push([{ table: "setting", data: { key: "targets", value, changed_by: session!.person.id, changed_at: nowIso() } }], true);
    });
    if (ok) onClose();
  };
  return (
    <Modal title="Targets" onClose={onClose}>
      <p className="-mt-2 mb-3 text-sm text-slate-500">Used on the dashboard, planning and electricity pages.</p>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Pellets a day (t)" value={f.p} onChange={set("p")} />
        <Field label="Briquettes a day (t)" value={f.b} onChange={set("b")} />
        <Field label="kWh per ton (whole plant)" value={f.k} onChange={set("k")} />
        <Field label="Days of raw material to keep" value={f.c} onChange={set("c")} />
      </div>
      <div className="mt-3 space-y-3">
        <ErrorText text={error} />
        <div className="flex justify-end gap-2">
          <Button kind="ghost" onClick={onClose}>Close</Button>
          <Button disabled={busy} onClick={save}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
