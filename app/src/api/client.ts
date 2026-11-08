// Fetch wrapper for bombkicker-api: Bearer token, JSON, error codes, one silent re-login on 401.
import type {
  ApiErrorBody,
  GuestLoginResponse,
  LedgerItem,
  Leaderboard,
  Me,
  Mode,
  MySkins,
  Page,
  PurchaseRequest,
  PurchaseResponse,
  SkinDto,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** status 0 = the request never got an HTTP answer (offline, DNS, CORS, timeout). */
export const NETWORK_ERROR = "NETWORK";

export interface ClientDeps {
  baseUrl: string;
  fetch: typeof fetch;
  /** Current access token, or null before login. */
  getToken: () => string | null;
  /** Log in again (the AuthProvider dedupes parallel calls) and return the new token. */
  relogin: () => Promise<string>;
  timeoutMs?: number;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  /** Send the Bearer token and re-login once on 401. Default true. */
  auth?: boolean;
}

export function createApiClient(deps: ClientDeps) {
  const timeoutMs = deps.timeoutMs ?? 15000;

  async function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
    const headers: Record<string, string> = {};
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await deps.fetch(`${deps.baseUrl}${path}`, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: ctrl.signal,
      });
    } catch (e) {
      throw new ApiError(0, NETWORK_ERROR, e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  async function parse<T>(res: Response): Promise<T> {
    const body: unknown = await res.json().catch(() => null);
    if (res.ok) return body as T;
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? res.statusText, err?.details);
  }

  async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const auth = opts.auth ?? true;
    let token = auth ? deps.getToken() : null;
    if (auth && !token) token = await deps.relogin();
    let res = await send(path, opts, token);
    if (res.status === 401 && auth) {
      token = await deps.relogin();
      res = await send(path, opts, token);
    }
    return parse<T>(res);
  }

  return {
    request,
    guestLogin: (deviceId: string) =>
      request<GuestLoginResponse>("/v1/auth/guest", { method: "POST", body: { deviceId }, auth: false }),
    me: () => request<Me>("/v1/me"),
    mySkins: () => request<MySkins>("/v1/me/skins"),
    skins: () => request<{ items: SkinDto[] }>("/v1/skins", { auth: false }).then((r) => r.items),
    purchase: (body: PurchaseRequest) => request<PurchaseResponse>("/v1/shop/purchases", { method: "POST", body }),
    equip: (skinKey: string) => request<{ equipped: string }>("/v1/me/equipped-skin", { method: "PATCH", body: { skinKey } }),
    pointsHistory: (cursor?: string | null, limit = 20) =>
      request<Page<LedgerItem>>(`/v1/me/points?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
    leaderboard: (mode: Mode, limit = 20) => request<Leaderboard>(`/v1/leaderboard?mode=${mode}&limit=${limit}`),
    nameSuggestions: () => request<{ names: string[] }>("/v1/names/suggestions").then((r) => r.names),
    setDisplayName: (displayName: string) => request<Me>("/v1/me", { method: "PATCH", body: { displayName } }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
