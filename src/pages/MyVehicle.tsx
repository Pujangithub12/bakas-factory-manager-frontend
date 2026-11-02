import { useEffect, useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { cls } from "../lib/util";
import { Badge, Button, Card, ErrorText, Field, Modal, PageHeader, Select, Table, Td, useRun } from "../components/ui";
import { onSiteMap, personName } from "../shared/rules";
import { fmtDuration, fmtTime, productionDayStart } from "../shared/time";
import { PURPOSES, addDiesel, lastMeter, openSession, startWork, stopWork, vehStats } from "../lib/vehicles";

const ms = (v: unknown) => new Date(String(v)).getTime();
const h1 = (n: number) => n.toFixed(1);

/** The working time, ticking every second. It re-renders on its own so the rest of the page stays still. */
function Since({ iso }: { iso: string }) {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setT(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  return <>{fmtDuration(t - ms(iso))}</>;
}

type Dialog = null | "start" | "stop" | "fuel";

/** The driver's vehicle on a laptop: start and stop work with the hour meter, add diesel, and see today's entries. */
export default function MyVehicle() {
  const { D, reload, needDays } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const { busy, error, setError, run } = useRun(reload);
  const [sel, setSel] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [meter, setMeter] = useState("");
  const [litres, setLitres] = useState("");
  const [job, setJob] = useState(PURPOSES[0]);

  // The laptop normally loads 3 days of records. Diesel use over 30 days needs 30.
  useEffect(() => { needDays(30); }, [needDays]);

  const allowed = D.vehicle
    .filter((v) => D.driver_vehicle.some((o) => o.person_id === me && o.vehicle_id === v.id))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const here = onSiteMap(D).has(me);

  const header = <PageHeader title={`Hello, ${session!.person.full_name}`} sub="Pick your vehicle. Start and stop work with the hour meter reading, and log every diesel fill." />;
  const gate = !here ? <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">You are not checked in at the gate.</p> : null;

  if (allowed.length === 0) {
    return (
      <div>
        {header}
        {gate}
        <p className="text-slate-600">No vehicle is set up for you yet. The supervisor ticks your vehicles on Shift & crew.</p>
      </div>
    );
  }

  const v = allowed.find((x) => x.id === sel) ?? allowed.find((x) => openSession(D, x.id)?.driver_id === me) ?? allowed[0];
  const os = openSession(D, v.id);
  const lockedBy = os && os.driver_id !== me ? String(os.driver_id) : null;
  const ok = here && !lockedBy;
  const last = lastMeter(D, v.id);
  const now = Date.now();
  const st = vehStats(D, v.id, now - 30 * 86_400_000, now + 1);
  const vname = (id: unknown) => D.vehicle.find((x) => x.id === id)?.name ?? "?";

  // Today's entries: my work sessions and my diesel fills since the production day began.
  const t0 = productionDayStart().getTime();
  const today = [
    ...D.vehicle_session.filter((x) => x.driver_id === me && ms(x.started_at) >= t0).map((x) => ({
      id: String(x.id), at: ms(x.started_at), vehicle: vname(x.vehicle_id),
      time: `${fmtTime(x.started_at)}-${x.stopped_at ? fmtTime(x.stopped_at) : "now"}`, what: String(x.job ?? ""),
      amount: x.meter_end != null ? `${h1(Number(x.meter_end) - Number(x.meter_start))} h` : "working",
    })),
    ...D.diesel_fill.filter((f) => f.by === me && ms(f.at) >= t0).map((f) => ({
      id: String(f.id), at: ms(f.at), vehicle: vname(f.vehicle_id), time: fmtTime(f.at), what: "Diesel", amount: `${Number(f.litres)} L`,
    })),
  ].sort((a, b) => b.at - a.at);

  const open = (d: Dialog) => {
    setError(null);
    setMeter(last != null ? String(last) : "");
    setLitres("");
    setJob(PURPOSES[0]);
    setDialog(d);
  };
  const close = () => { setDialog(null); setError(null); };

  const stopStart = os ? Number(os.meter_start) : 0;
  const stopMeter = parseFloat(meter.replace(",", "."));

  return (
    <div>
      {header}
      {gate}

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Your vehicles">
        {allowed.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setSel(x.id)}
            aria-pressed={x.id === v.id}
            className={cls("rounded-xl border px-4 py-2 text-left text-sm", x.id === v.id ? "border-brand-600 bg-brand-50" : "border-slate-300 bg-white hover:bg-slate-50")}
          >
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{String(x.type)}</div>
            <div className="flex items-center gap-2 font-semibold">
              <span className={cls("inline-block h-2.5 w-2.5 rounded-full", openSession(D, x.id) ? "bg-emerald-600" : "bg-slate-400")} />
              {String(x.name)}
            </div>
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className={cls("border-t-4", os ? "border-t-emerald-600" : "border-t-slate-400")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{String(v.type)}</div>
              <div className="font-display text-3xl font-bold leading-tight">{String(v.name)}</div>
              {v.reg_no ? <div className="text-sm text-slate-500">{String(v.reg_no)}</div> : null}
            </div>
            {os ? <Badge tone="good">Working</Badge> : <Badge>Parked</Badge>}
          </div>

          <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-2 text-sm">
            {os ? (
              <>
                <dt className="text-slate-500">Since</dt>
                <dd>{fmtTime(String(os.started_at))} · <Since iso={String(os.started_at)} /></dd>
                <dt className="text-slate-500">Driver</dt>
                <dd>{personName(D, String(os.driver_id))}</dd>
                <dt className="text-slate-500">Job</dt>
                <dd>{String(os.job ?? "")}</dd>
              </>
            ) : null}
            <dt className="text-slate-500">Hour meter</dt>
            <dd>{last != null ? `${h1(last)} h` : "-"}</dd>
            <dt className="text-slate-500">Diesel use</dt>
            <dd>{st.lph ? `${h1(st.lph)} L per hour (last 30 days)` : "not enough fills yet"}</dd>
          </dl>

          {lockedBy ? <p className="mt-3 text-sm text-amber-700">In use by {personName(D, lockedBy)}.</p> : null}

          <div className="mt-4 flex flex-wrap gap-2">
            {os ? (
              <Button kind="danger" disabled={!ok} onClick={() => open("stop")}>Stop work</Button>
            ) : (
              <Button disabled={!ok} onClick={() => open("start")}>Start work</Button>
            )}
            <Button kind="soft" disabled={!ok} onClick={() => open("fuel")}>Add diesel</Button>
          </div>
        </Card>

        <div>
          <h2 className="mb-2 font-semibold">Your entries today</h2>
          <Table head={["Vehicle", "Time", "What", "Hours / litres"]} empty="Nothing yet today.">
            {today.map((e) => (
              <tr key={e.id}>
                <Td>{e.vehicle}</Td>
                <Td>{e.time}</Td>
                <Td>{e.what}</Td>
                <Td className="text-right">{e.amount}</Td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      {dialog === "start" ? (
        <Modal title={`Start work · ${v.name}`} onClose={close}>
          <div className="space-y-3">
            <Field label="Hour meter now" value={meter} onChange={setMeter} hint={last != null ? `Last reading ${h1(last)} h` : undefined} />
            <Select label="Job" value={job} onChange={setJob} options={PURPOSES.map((p) => ({ value: p, label: p }))} />
            <ErrorText text={error} />
            <Button disabled={busy} onClick={() => run(async () => { await startWork(D, v.id as string, me, meter, job); close(); })}>Start work</Button>
          </div>
        </Modal>
      ) : null}

      {dialog === "stop" && os ? (
        <Modal title={`Stop work · ${v.name}`} onClose={close}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Started {fmtTime(String(os.started_at))} at {h1(stopStart)} h</p>
            <Field label="Hour meter now" value={meter} onChange={setMeter} />
            <p className="text-sm text-slate-600">{Number.isFinite(stopMeter) ? `${h1(stopMeter - stopStart)} hours worked.` : "Enter the reading to see hours worked."}</p>
            <ErrorText text={error} />
            <Button kind="danger" disabled={busy} onClick={() => run(async () => { await stopWork(os, meter); close(); })}>Stop work</Button>
          </div>
        </Modal>
      ) : null}

      {dialog === "fuel" ? (
        <Modal title={`Add diesel · ${v.name}`} onClose={close}>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">Write it down at every fill so diesel use per hour can be worked out.</p>
            <Field label="Litres filled" value={litres} onChange={setLitres} />
            <Field label="Hour meter at the fill" value={meter} onChange={setMeter} />
            <ErrorText text={error} />
            <Button disabled={busy} onClick={() => run(async () => { await addDiesel(D, v.id as string, me, litres, meter); close(); })}>Save fill</Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}