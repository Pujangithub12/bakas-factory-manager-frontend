import { useState } from "react";
import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { fixJob, takeJob } from "../lib/flows";
import { Badge, Button, ErrorText, Modal, PageHeader, Table, TextArea, Td, useRun } from "../components/ui";
import { machineOf, personName } from "../shared/rules";
import { fmtDateTime, type Row } from "../shared/time";

const tone = (k: string) => (k === "breakdown" || k === "bypass" ? "bad" : k === "wear" ? "warn" : "info") as "bad" | "warn" | "info";

export default function Jobs() {
  const { D } = useData();
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [open, setOpen] = useState<Row | null>(null);

  const list = D.maintenance_job
    .filter((j) => (filter === "all" ? true : !j.fixed_at))
    .sort((a, b) => (a.fixed_at ? 1 : 0) - (b.fixed_at ? 1 : 0) || b.reported_at.localeCompare(a.reported_at));
  const status = (j: Row) => (j.fixed_at ? <Badge tone="good">Fixed</Badge> : j.fitter_id ? <Badge tone="info">Working on it</Badge> : <Badge tone="warn">Reported</Badge>);
  const current = open ? D.maintenance_job.find((j) => j.id === open.id) ?? open : null;

  return (
    <div>
      <PageHeader title="Maintenance jobs" sub="Reported → Working on it → Fixed. A machine stopped for a breakdown cannot restart until its job is fixed.">
        <Button small kind={filter === "open" ? "primary" : "ghost"} onClick={() => setFilter("open")}>Open</Button>
        <Button small kind={filter === "all" ? "primary" : "ghost"} onClick={() => setFilter("all")}>All</Button>
      </PageHeader>
      <Table head={["Machine", "Kind", "Problem", "Reported", "By", "Status", "Fitter", ""]} empty="No jobs.">
        {list.map((j) => (
          <tr key={j.id}>
            <Td className="font-semibold">{machineOf(D, j.machine_id)?.tag}</Td>
            <Td><Badge tone={tone(j.kind)}>{j.kind}</Badge></Td>
            <Td className="max-w-xs">{j.problem}{j.machine_stopped && !j.fixed_at ? <Badge tone="bad">Machine down</Badge> : null}</Td>
            <Td>{fmtDateTime(j.reported_at)}</Td><Td>{personName(D, j.reported_by)}</Td><Td>{status(j)}</Td>
            <Td>{j.fitter_id ? personName(D, j.fitter_id) : "-"}</Td>
            <Td><Button small kind="ghost" onClick={() => setOpen(j)}>Open</Button></Td>
          </tr>
        ))}
      </Table>
      {current ? <JobModal job={current} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function JobModal({ job, onClose }: { job: Row; onClose: () => void }) {
  const { D, reload } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const roles = session!.roles;
  const mgmt = roles.some((r) => ["Owner", "Manager", "Supervisor"].includes(r));
  const fitter = mgmt || roles.some((r) => r === "Fitter");
  const [work, setWork] = useState("");
  const [parts, setParts] = useState("");
  const { busy, error, run } = useRun(reload);

  return (
    <Modal title={`${machineOf(D, job.machine_id)?.tag} · ${job.kind}`} onClose={onClose}>
      <p className="font-semibold">{job.problem}</p>
      {job.note ? <p className="text-sm">{job.note}</p> : null}
      <p className="mt-1 text-sm text-slate-500">Reported by {personName(D, job.reported_by)} · {fmtDateTime(job.reported_at)}</p>
      {job.machine_stopped && !job.fixed_at ? <p className="mt-2 text-sm text-red-700">The machine stays Down until this is fixed.</p> : null}
      {job.fitter_id ? <p className="text-sm text-slate-500">{personName(D, job.fitter_id)} took it {fmtDateTime(job.started_at)}</p> : null}
      {job.fixed_at ? (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm"><b>Fixed {fmtDateTime(job.fixed_at)}.</b><br />Work done: {job.work_done}{job.parts_used ? <><br />Parts used: {job.parts_used}</> : null}</div>
      ) : (
        <div className="mt-4 space-y-3">
          <ErrorText text={error} />
          {!job.fitter_id ? (
            fitter ? <Button disabled={busy} onClick={() => run(() => takeJob(job.id, me))}>Take this job</Button> : <p className="text-sm text-slate-500">Only a fitter can take this job.</p>
          ) : job.fitter_id === me || mgmt ? (
            <>
              <TextArea label="Work done" value={work} onChange={setWork} />
              <TextArea label="Parts used (optional)" value={parts} onChange={setParts} />
              <Button disabled={busy} onClick={async () => { if (await run(() => fixJob(D, job, work, parts))) onClose(); }}>Mark fixed</Button>
            </>
          ) : <p className="text-sm text-slate-500">{personName(D, job.fitter_id)} is working on it.</p>}
        </div>
      )}
    </Modal>
  );
}
