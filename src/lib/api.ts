const DEFAULT_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

export const getApiUrl = () => localStorage.getItem("api_url") || DEFAULT_URL;
export const setApiUrl = (u: string) => localStorage.setItem("api_url", u.trim().replace(/\/+$/, ""));

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (f: () => void) => { onUnauthorized = f; };

export async function api<T>(path: string, opts: { body?: unknown; method?: string } = {}): Promise<T> {
  const token = localStorage.getItem("token");
  let res: Response;
  try {
    res = await fetch(getApiUrl() + path, {
      method: opts.method ?? (opts.body ? "POST" : "GET"),
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Cannot reach the server at ${getApiUrl()}. Is it running?`);
  }
  const json = await res.json().catch(() => null);
  if (res.status === 401 && token) onUnauthorized();
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Server error ${res.status}`);
  return json as T;
}

export type WriteOp = { table: string; op?: "upsert" | "delete"; data: Record<string, unknown> };

/** Save through the server. `admin` is for corrections and Setup lists (Owner and Manager). */
export async function push(ops: WriteOp[], admin = false): Promise<void> {
  const r = await api<{ results: { ok: boolean; error?: string }[] }>(admin ? "/admin/push" : "/sync/push", {
    body: { ops: ops.map((o) => ({ table: o.table, op: o.op ?? "upsert", data: o.data })) },
  });
  const bad = r.results.find((x) => !x.ok);
  if (bad) throw new Error(bad.error ?? "The server refused this entry");
}

export const newId = () => crypto.randomUUID();
