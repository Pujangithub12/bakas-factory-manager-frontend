import { useData } from "../lib/data";
import { useAuth } from "../lib/auth";
import { push } from "../lib/api";
import { Card, ErrorText, PageHeader, useRun } from "../components/ui";
import { cls } from "../lib/util";
import { nowIso } from "../shared/time";

/** The phone roles and their tabs: [key, tab label, screen title, optional "$" = owner and finance only]. "home" and "me" always stay on. */
const APP: Record<string, { label: string; who: string[]; hint: string; tabs: [string, string, string?][] }> = {
  owner: { label: "Owner", who: ["Owner", "Manager"], hint: "Dashboard: raw material, production, machines, people",
    tabs: [["home", "Dashboard"], ["mach", "Machines"], ["ppl", "People"], ["money", "Money", "$"], ["me", "Your details"]] },
  operator: { label: "Operator", who: ["Operator"], hint: "Machines, checks, log sheets",
    tabs: [["home", "Your machine"], ["sheet", "Log sheet"], ["jobs", "Problems"], ["info", "Machine details"], ["me", "Your details"]] },
  driver: { label: "Driver", who: ["Driver"], hint: "JCB and tractors, diesel",
    tabs: [["home", "Your vehicle"], ["hist", "History"], ["me", "Your details"]] },
  security: { label: "Security", who: ["Security guard"], hint: "Gate register, new workers",
    tabs: [["home", "Gate register"], ["today", "Today at the gate"], ["vis", "Visitors"], ["me", "Your details"]] },
  supervisor: { label: "Supervisor", who: ["Supervisor"], hint: "Cross-check crew, in-charge, floor",
    tabs: [["home", "Crew this shift"], ["floor", "On the floor"], ["me", "Your details"]] },
  fitter: { label: "Fitter", who: ["Fitter", "Electrician"], hint: "Maintenance jobs and the plan",
    tabs: [["home", "Maintenance jobs"], ["plan", "Maintenance plan"], ["done", "Fixed this week"], ["me", "Your details"]] },
  store: { label: "Store", who: ["Store supervisor"], hint: "Tools out and back, stock, requests",
    tabs: [["home", "Tools and stock"], ["stock", "Stock"], ["req", "Purchase requests"], ["me", "Your details"]] },
  weighbridge: { label: "Weighbridge", who: ["Weighbridge clerk", "Accountant"], hint: "Trucks in and out, slip photos",
    tabs: [["home", "Weighbridge"], ["slips", "Printed slips"], ["me", "Your details"]] },
};

function Switch({ on, label, disabled, onClick }: { on: boolean; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={cls("relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50", on ? "bg-brand-700" : "bg-slate-300")}>
      <span className={cls("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

/** Switch each phone screen on or off. Off means nobody can sign in to it on a phone. */
export default function PhoneApp() {
  const { D, reload } = useData();
  const { session } = useAuth();
  const me = session!.person.id;
  const can = session!.roles.some((r) => r === "Owner" || r === "Manager");
  const { busy, error, run } = useRun(reload);

  // Rows missing means on.
  const isOn = (key: string) => D.phone_screen.find((s) => s.screen === key)?.is_on !== false;
  const flip = (key: string) =>
    run(() => push([{ table: "phone_screen", data: { screen: key, is_on: !isOn(key), changed_by: me, changed_at: nowIso() } }], true));
  const off = busy || !can;

  return (
    <div>
      <PageHeader title="Phone app" sub="Switch each phone screen on or off. Off means nobody can sign in to it on a phone; that work is done on the laptop. Only the factory manager and the owner can change this." />
      <div className="mb-3"><ErrorText text={error} /></div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Object.entries(APP).map(([k, r]) => {
          const on = isOn(k);
          return (
            <Card key={k} className={on ? "" : "opacity-70"}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <b className="block">{r.label}</b>
                  <small className="block text-slate-500">{r.hint} · {r.who.join(", ")}</small>
                </div>
                <Switch on={on} label={`${r.label} on the phone`} disabled={off} onClick={() => flip(k)} />
              </div>
              {r.tabs.filter((t) => t[0] !== "home" && t[0] !== "me").map((t) => (
                <div key={t[0]} className="mt-3 flex items-center gap-3 border-t border-slate-100 pt-3 text-sm">
                  <span className="flex-1">{t[1]}{t[2] === "$" ? <small className="ml-1 text-slate-400">(owner and finance only)</small> : null}</span>
                  <Switch on={isOn(`${k}.${t[0]}`)} label={`${r.label}: ${t[1]}`} disabled={off} onClick={() => flip(`${k}.${t[0]}`)} />
                </div>
              ))}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
