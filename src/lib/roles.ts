// Same rules as backend/src/roles.ts. The server is what enforces them; this only decides what to show.
export const ROLE_LIST = ["Owner", "Manager", "Supervisor", "Operator", "Driver", "Security", "Fitter", "Store", "Weighbridge", "Helper"] as const;

export const ROLE_BLURB: Record<string, string> = {
  Owner: "Dashboard: raw material, production, machines, people",
  Manager: "Admin: users, roles, dashboard, setup",
  Supervisor: "Cross-check crew, in-charge, floor",
  Operator: "Machines, checks, log sheets",
  Driver: "JCB and tractors, diesel",
  Security: "Gate register, new workers",
  Fitter: "Maintenance jobs and the plan",
  Store: "Tools out and back, stock, requests",
  Weighbridge: "Trucks in and out, yards, bag count",
  Helper: "Crews a machine; no app sign-in",
};

/** The cards on the sign-in page, in order. Helper is a worker role with no sign-in. */
export const SIGN_IN_ROLES = ["Owner", "Manager", "Operator", "Driver", "Security", "Supervisor", "Fitter", "Store", "Weighbridge"] as const;
export const SIGN_IN_FOOTER = "The lab uses the laptop. The factory manager or the owner switches phone screens on and off (Setup: Phone app).";

/** Owner 3, Manager 2, Supervisor 1, anyone else 0. */
export const rank = (roles: string[]) => (roles.includes("Owner") ? 3 : roles.includes("Manager") ? 2 : roles.includes("Supervisor") ? 1 : 0);

/** Roles this person may give or take away. The Owner role never; Manager only the Owner; Supervisor an admin. */
export function grantableRoles(actor: string[]): string[] {
  const owner = actor.includes("Owner");
  const admin = rank(actor) >= 2;
  return ROLE_LIST.filter((r) => r !== "Owner" && (r !== "Manager" || owner) && (r !== "Supervisor" || admin));
}

/** May the actor remove this person or set their PIN? Themselves, or someone who outranks them (the Owner can manage anyone). */
export function canManage(actorId: string, actor: string[], targetId: string, target: string[]) {
  if (actorId === targetId) return true;
  const a = rank(actor);
  return a === 3 || a > rank(target);
}
