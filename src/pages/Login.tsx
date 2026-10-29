import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { ROLE_BLURB, SIGN_IN_FOOTER, SIGN_IN_ROLES } from "../lib/roles";
import { Button, ErrorText, Field, Logo, PinPad } from "../components/ui";

type Person = { id: string; full_name: string; role: string | null };
const PIN_LENGTH = 6;
const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
const weak = (pin: string) => "0123456789".includes(pin) || "9876543210".includes(pin);

const Brand = () => (
  <div className="mb-2 flex items-center gap-4">
    <Logo size={62} />
    <div>
      <div className="font-display text-4xl font-bold leading-none">BAKAS FACTORY</div>
      <div className="text-sm text-slate-500">Bakas Renewable Energy · Sarlahi</div>
    </div>
  </div>
);

const Shell = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-screen items-start justify-center bg-page p-6 sm:items-center">
    <div className="w-full max-w-md space-y-5">{children}</div>
  </div>
);

/** Sign in: the first run creates the one Owner; after that pick a role, then enter the 6-digit PIN. */
export default function Login() {
  const { signInRole, setupOwner } = useAuth();
  const [mode, setMode] = useState<"loading" | "setup" | "pick" | "pin">("loading");
  const [counts, setCounts] = useState<{ role: string; count: number }[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setMode("loading");
    setError(null);
    try {
      const status = await api<{ setup_needed: boolean }>("/auth/status");
      if (status.setup_needed) return setMode("setup");
      setCounts((await api<{ roles: { role: string; count: number }[] }>("/auth/roles")).roles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the server");
    }
    setMode("pick");
  };
  useEffect(() => { load(); }, []);

  if (mode === "loading") return <Shell><p className="text-center text-slate-500">Connecting...</p></Shell>;
  if (mode === "setup") return <OwnerSetup onDone={setupOwner} />;

  if (mode === "pin" && pick) {
    return <PinScreen name={pick} onBack={() => { setPick(null); setMode("pick"); }} onPin={(pin) => signInRole(pick, pin).then(() => undefined)} />;
  }

  return (
    <Shell>
      <Brand />
      <div>
        <h1 className="font-bold">Sign in</h1>
        <p className="mt-1 text-lg text-slate-500">Who is using this computer?</p>
      </div>
      <div className="space-y-3">
        {SIGN_IN_ROLES.map((role) => {
          const empty = counts.length > 0 && (counts.find((c) => c.role === role)?.count ?? 0) === 0;
          return (
            <button key={role} onClick={() => { setPick(role); setMode("pin"); }} className={`flex w-full items-center gap-4 rounded-2xl border border-[#d9d5cc] bg-card p-4 text-left shadow-sm transition hover:border-brand-600 ${empty ? "opacity-55" : ""}`}>
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-100 font-display text-xl font-bold text-brand-700">{role[0]}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-lg font-semibold">{role}</span>
                <span className="block text-sm text-slate-500">{ROLE_BLURB[role]}</span>
              </span>
              {empty ? <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-500">No one yet</span> : null}
            </button>
          );
        })}
        <ErrorText text={error} />
        <p className="pt-1 text-sm leading-5 text-slate-500">{SIGN_IN_FOOTER}</p>
        <Button kind="ghost" small onClick={load}>Try again</Button>
      </div>
    </Shell>
  );
}
/** Back, the person's initial, their name, six dots and a number pad. */
function PinScreen({ name, title, onBack, onPin }: { name: string; title?: string; onBack?: () => void; onPin: (pin: string) => Promise<string | void> }) {
  return (
    <Shell>
      <div className="h-8">
        {onBack ? <button onClick={onBack} className="flex items-center gap-1 text-lg font-semibold text-slate-800">‹ Back</button> : null}
      </div>
      <div className="flex flex-col items-center gap-2 pb-2 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full border border-[#d9d5cc] bg-card font-display text-4xl font-bold">{initials(name).slice(0, 1)}</span>
        <h1 className="font-bold">{name}</h1>
        <p className="text-lg text-slate-500">{title ?? `Enter your ${PIN_LENGTH}-digit PIN`}</p>
      </div>
      <PinPad length={PIN_LENGTH} onComplete={onPin} />
    </Shell>
  );
}

/** First run only: name, then choose and confirm a 6-digit PIN. This person becomes the Owner. */
function OwnerSetup({ onDone }: { onDone: (name: string, pin: string) => Promise<void> }) {
  const [step, setStep] = useState<"name" | "pin" | "confirm">("name");
  const [name, setName] = useState("");
  const [first, setFirst] = useState("");
  const [mismatch, setMismatch] = useState(false);

  if (step === "name") {
    return (
      <Shell>
        <Brand />
        <div>
          <h1 className="font-bold">Welcome</h1>
          <p className="mt-1 text-lg text-slate-500">Set up the Owner. The Owner is the super admin and decides who else gets access.</p>
        </div>
        <Field label="Your name" value={name} onChange={setName} />
        <Button disabled={name.trim().length < 2} onClick={() => setStep("pin")}>Continue</Button>
      </Shell>
    );
  }

  return (
    <PinScreen
      key={step}
      name="Owner"
      title={step === "confirm" ? "Enter it again to confirm" : mismatch ? "The PINs did not match. Choose a PIN again" : `Choose a ${PIN_LENGTH}-digit PIN`}
      onBack={() => { setFirst(""); setStep(step === "confirm" ? "pin" : "name"); }}
      onPin={async (pin) => {
        if (step === "pin") {
          if (weak(pin)) return "Choose a PIN that is not a run like 123456";
          setFirst(pin);
          setMismatch(false);
          setStep("confirm");
          return;
        }
        if (pin !== first) { setFirst(""); setMismatch(true); setStep("pin"); return; }
        await onDone(name.trim(), pin);
      }}
    />
  );
}
