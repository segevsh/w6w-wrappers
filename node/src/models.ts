/**
 * `client.models.*`, `client.modelRoutes.*` and `client.modelUsage.*` — the model
 * registry: the catalog, named routes, and the completion gateway.
 *
 * Six operations, one HTTP call each (`endpoints.json`). The rest of the model surface (catalog edits, rates,
 * budgets, route writes) lives in the unstable `client.console.models` group.
 *
 * **`modelRoutes.complete` returns the flat gateway envelope as-is** —
 * `invocationId`, `status` and `key` included — and never unwraps it to
 * `output` (DC-5/G-W4). Routes and usage are project-scoped: `?project=` is
 * resolved per call, then from the client default.
 *
 * @module
 */

import type { ResolvedConfig } from "./config.ts";
import { type CallOptions, type HttpResponse, path, type RequestOptions } from "./http.ts";

/** The slice of `W6WClient` these namespaces need. */
export interface ModelsHost {
  /** The resolved configuration; only `project` is read. */
  readonly config: ResolvedConfig;
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** The wire dialect a completion is spoken in. */
export type ModelDialect = "openai" | "anthropic" | "ollama";
/** How much of the gateway response a completion returns. */
export type ModelResponseMode = "both" | "output" | "raw";

/** One catalog entry. Fields beyond `id` are server-defined and may grow. */
export interface Model {
  id: string;
  provider?: string;
  status?: string;
  [field: string]: unknown;
}

/** One named model route. */
export interface ModelRoute {
  name: string;
  [field: string]: unknown;
}

/** A keyset-paged catalog page. */
export interface ModelPage {
  models: Model[];
  nextCursor: string | null;
}

/** The flat completion envelope, returned without unwrapping. */
export interface ModelCompletion {
  invocationId: string;
  status: string;
  key?: string;
  output?: unknown;
  raw?: unknown;
  [field: string]: unknown;
}

/** The result of `modelUsage.query`. */
export interface ModelUsageReport {
  totals: Record<string, unknown>;
  /**
   * `true` when the server stopped folding the ledger at its aggregate row cap,
   * so `totals` and `groups` cover only part of the filtered window.
   */
  totalsTruncated: boolean;
  groups?: Record<string, unknown>[];
  items: Record<string, unknown>[];
  nextCursor: string | null;
}

/** `models.list` options. */
export interface ModelListOptions extends CallOptions {
  provider?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}

/** Project-scoped call options. */
export interface ModelRouteOptions extends CallOptions {
  /** Project id to scope this call to. */
  project?: string;
}

/** `modelRoutes.complete` options. */
export interface ModelCompleteOptions extends ModelRouteOptions {
  dialect?: ModelDialect;
  response?: ModelResponseMode;
}

/** `modelUsage.query` options. */
export interface ModelUsageOptions extends ModelRouteOptions {
  groupBy?: "route" | "model" | "day";
  from?: string;
  to?: string;
  route?: string;
  model?: string;
  limit?: number;
  cursor?: string;
}

/** Strip a single-key envelope if present, else take the body as sent. */
function pick<T>(res: HttpResponse<unknown>, key: string): T {
  const b = res.body;
  if (typeof b === "object" && b !== null && !Array.isArray(b)) {
    const v = (b as Record<string, unknown>)[key];
    if (v !== undefined && v !== null) return v as T;
  }
  return b as T;
}

/** `client.models` — the catalog. */
export class ModelsApi {
  readonly #host: ModelsHost;

  constructor(host: ModelsHost) {
    this.#host = host;
  }

  /** List the catalog; returns the whole page `{models, nextCursor}`. */
  async list(options?: ModelListOptions): Promise<ModelPage> {
    const res = await this.#host.request<ModelPage>({
      method: "GET",
      path: "/models",
      query: {
        provider: options?.provider,
        status: options?.status,
        limit: options?.limit,
        cursor: options?.cursor,
      },
      signal: options?.signal,
    });
    return res.body as ModelPage;
  }

  /** Read one catalog entry by its catalog id (`mdl_…`), not a provider-native model id. */
  async get(id: string, options?: CallOptions): Promise<Model> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/models/${id}`,
      signal: options?.signal,
    });
    return pick<Model>(res, "model");
  }
}

/** `client.modelRoutes` — named routes and the completion gateway. */
export class ModelRoutesApi {
  readonly #host: ModelsHost;

  constructor(host: ModelsHost) {
    this.#host = host;
  }

  #project(options?: ModelRouteOptions): string | undefined {
    return options?.project ?? this.#host.config.project ?? undefined;
  }

  /** List the project's routes. */
  async list(options?: ModelRouteOptions): Promise<ModelRoute[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/model-routes",
      query: { project: this.#project(options) },
      signal: options?.signal,
    });
    return pick<ModelRoute[]>(res, "routes");
  }

  /** Read one route by name. */
  async get(name: string, options?: ModelRouteOptions): Promise<ModelRoute> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: path`/model-routes/${name}`,
      query: { project: this.#project(options) },
      signal: options?.signal,
    });
    return pick<ModelRoute>(res, "route");
  }

  /** POST `input` to `/model-routes/{name}/complete`; the flat envelope, not unwrapped. */
  async complete(
    name: string,
    input: Record<string, unknown>,
    options?: ModelCompleteOptions,
  ): Promise<ModelCompletion> {
    const res = await this.#host.request<ModelCompletion>({
      method: "POST",
      path: path`/model-routes/${name}/complete`,
      query: {
        project: this.#project(options),
        dialect: options?.dialect,
        response: options?.response,
      },
      body: input,
      signal: options?.signal,
    });
    return res.body as ModelCompletion;
  }
}

/** `client.modelUsage` — recorded usage. */
export class ModelUsageApi {
  readonly #host: ModelsHost;

  constructor(host: ModelsHost) {
    this.#host = host;
  }

  /** Query usage; returns `{totals, groups?, items, nextCursor}` as sent. */
  async query(options?: ModelUsageOptions): Promise<ModelUsageReport> {
    const res = await this.#host.request<ModelUsageReport>({
      method: "GET",
      path: "/model-usage",
      query: {
        project: options?.project ?? this.#host.config.project ?? undefined,
        groupBy: options?.groupBy,
        from: options?.from,
        to: options?.to,
        route: options?.route,
        model: options?.model,
        limit: options?.limit,
        cursor: options?.cursor,
      },
      signal: options?.signal,
    });
    return res.body as ModelUsageReport;
  }
}
