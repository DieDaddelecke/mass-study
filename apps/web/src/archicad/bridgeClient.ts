/**
 * HTTP client for the local Kubatur Archicad bridge (tools/archicad-bridge/bridge.py).
 * The browser cannot call Archicad's JSON API directly (no CORS headers, see docs/ARCHICAD.md),
 * so every Archicad call goes through the bridge on 127.0.0.1.
 */

export const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:19780';

export interface BridgeHealth {
  ok: boolean;
  name: string;
  version: string;
  /** True when the token sent with the request is valid. */
  authorized: boolean;
}

export interface ArchicadInstance {
  port: number;
  product?: { version: number; buildNumber: number; languageCode: string };
  tapirVersion?: string | null;
  project?: {
    isUntitled?: boolean;
    isTeamwork?: boolean;
    projectName?: string;
    projectPath?: string;
  };
  error?: string;
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly kind: 'unreachable' | 'unauthorized' | 'refused' | 'archicad',
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Minimal interface used by the transfer logic; tests pass a fake. */
export interface ArchicadCaller {
  call<T = unknown>(port: number, command: string, parameters?: unknown): Promise<T>;
}

export class BridgeClient implements ArchicadCaller {
  constructor(
    readonly baseUrl: string = DEFAULT_BRIDGE_URL,
    readonly token: string = '',
    private readonly fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async request<T>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new BridgeError(String(e), 'unreachable');
    }
    let json: { ok?: boolean; result?: T; error?: { message?: string } } & Record<string, unknown>;
    try {
      json = (await res.json()) as typeof json;
    } catch {
      throw new BridgeError(`HTTP ${res.status}`, 'unreachable', res.status);
    }
    if (res.status === 401)
      throw new BridgeError(json.error?.message ?? 'unauthorized', 'unauthorized', 401);
    if (res.status === 403) throw new BridgeError(json.error?.message ?? 'refused', 'refused', 403);
    if (!res.ok || json.ok === false)
      throw new BridgeError(json.error?.message ?? `HTTP ${res.status}`, 'archicad', res.status);
    return (json.result ?? json) as T;
  }

  health(): Promise<BridgeHealth> {
    return this.request<BridgeHealth>('/health');
  }

  instances(): Promise<ArchicadInstance[]> {
    return this.request<{ instances: ArchicadInstance[] }>('/instances').then((r) => r.instances);
  }

  /** `command` is a Tapir command name, or `API.<name>` for a built-in Archicad command. */
  call<T = unknown>(port: number, command: string, parameters: unknown = {}): Promise<T> {
    return this.request<T>('/call', { port, command, parameters });
  }
}
