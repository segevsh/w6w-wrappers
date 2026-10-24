/**
 * `client.console.models.*` — the model registry's console-only routes: catalog
 * edits, rates, discovery, providers, budgets (CRUD + usage) and route writes.
 *
 * **Studio-internal, not the published partner contract.** The six stable
 * operations (`models.list|get`, `modelRoutes.list|get|complete`,
 * `modelUsage.query`) live on the root client (`../models.ts`,
 * `endpoints.json`). This namespace lives under the `console` subpath export
 * and is excluded from `endpoints.json` and the root barrel.
 *
 * **`complete` is deliberately NOT modeled here.** `client.modelRoutes.complete`
 * already reaches it and returns the flat envelope as-is; a second method would
 * give a caller two ways to the same route (the precedent of
 * `console/aliases.ts`). Catalog writes and budget writes need a tenant admin.
 *
 * @module
 */

import { type HttpResponse, path, type RequestOptions } from "../http.ts";
import type { Model, ModelRoute } from "../models.ts";
import { unwrap } from "../types.ts";

/** The slice of `W6WClient` this namespace needs: the transport. */
export interface ModelsConsoleHost {
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** Per-call options for the project-scoped methods. */
export interface ModelsConsoleOptions {
  /** Project slug; overrides the client default. */
  project?: string;
  /** Abort signal. */
  signal?: AbortSignal;
}

/** Fields `updateModel` may change. */
export interface ModelPatch {
  status?: "active" | "deprecated" | "blocked";
  displayName?: string;
  limits?: { maxInputTokens?: number; maxOutputTokens?: number };
}

/** A rate card stored against a model. */
export interface ModelRate {
  id: string;
  modelId: string;
  effectiveFrom: string;
  rates: Record<string, unknown>;
  source: "seed" | "tenant";
}

/** The result of `discover`. */
export interface ModelDiscoveryResult {
  added: string[];
  updated: string[];
  deprecated: string[];
}

/** One provider the host can speak to. */
export interface ModelProvider {
  appId: string;
  provider: string;
  installed: boolean;
}

/** Spend/usage caps of a budget. */
export interface ModelBudgetLimits {
  requests?: number;
  tokens?: number;
  costMinor?: number;
  currency?: string;
}

/** A stored budget. */
export interface ModelBudget {
  id: string;
  project: string;
  scopeKind: string;
  scopeId: string | null;
  window: string;
  limits: ModelBudgetLimits;
  onBreach: string;
  [field: string]: unknown;
}

/** Body of `createBudget`. */
export interface ModelBudgetInput {
  scopeKind: string;
  scopeId?: string;
  window: string;
  limits: ModelBudgetLimits;
  onBreach: string;
}

/** A budget's live consumption. */
export interface ModelBudgetUsage {
  budgetId: string;
  window: string;
  windowStart: string;
  limits: ModelBudgetLimits;
  used: { requests: number; tokens: number; costMinor: number };
  reserved: { requests: number; tokens: number; costMinor: number };
}

/** A `{model, connection}` fallback hop. */
export interface ModelFallback {
  model: string;
  connection: string;
}

/** Body of `createRoute`. */
export interface ModelRouteInput {
  name: string;
  model: string;
  connection: string;
  fallbacks?: ModelFallback[];
  defaults?: Record<string, unknown>;
}

/** Body of `updateRoute`. */
export type ModelRoutePatch = Partial<Omit<ModelRouteInput, "name">>;

/**
 * The `console.models` namespace on a `W6WClient`.
 *
 * @example
 * ```ts
 * await client.console.models.discover("conn_1");
 * await client.console.models.createRoute({ name: "chat", model: "mdl_1", connection: "conn_1" });
 * ```
 */
export class ModelsConsoleApi {
  readonly #host: ModelsConsoleHost;

  /** @param host - The client this namespace issues requests through. */
  constructor(host: ModelsConsoleHost) {
    this.#host = host;
  }

  /** `PATCH /models/:id` — edit a catalog entry (tenant admin). */
  async updateModel(id: string, patch: ModelPatch): Promise<Model> {
    const res = await this.#host.request<unknown>({
      method: "PATCH",
      path: path`/models/${id}`,
      body: patch,
    });
    return unwrap<Model>(res, "model");
  }

  /** `PUT /models/:id/rates` — store a rate card (tenant admin, `201`). */
  async putRates(
    id: string,
    input: { effectiveFrom: string; rates: Record<string, unknown> },
  ): Promise<ModelRate> {
    const res = await this.#host.request<unknown>({
      method: "PUT",
      path: path`/models/${id}/rates`,
      body: input,
    });
    return unwrap<ModelRate>(res, "rate");
  }

  /** `POST /models/discover` — sync a connection's models into the catalog (tenant admin). */
  async discover(connection: string): Promise<ModelDiscoveryResult> {
    const res = await this.#host.request<ModelDiscoveryResult>({
      method: "POST",
      path: "/models/discover",
      body: { connection },
    });
    return res.body;
  }

  /** `GET /models/providers` — the providers the host maps. */
  async providers(): Promise<ModelProvider[]> {
    const res = await this.#host.request<unknown>({ method: "GET", path: "/models/providers" });
    return unwrap<ModelProvider[]>(res, "providers");
  }

  /** `GET /model-budgets` — the project's budgets. */
  async listBudgets(options?: ModelsConsoleOptions): Promise<ModelBudget[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/model-budgets",
      query: { project: options?.project },
      signal: options?.signal,
    });
    return unwrap<ModelBudget[]>(res, "budgets");
  }

  /** `POST /model-budgets` — create a budget (tenant admin, `201`). */
  async createBudget(
    input: ModelBudgetInput,
    options?: ModelsConsoleOptions,
  ): Promise<ModelBudget> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: "/model-budgets",
      query: { project: options?.project },
      body: input,
      signal: options?.signal,
    });
    return unwrap<ModelBudget>(res, "budget");
  }

  /** `PATCH /model-budgets/:id` — edit a budget (tenant admin). */
  async updateBudget(id: string, patch: Partial<ModelBudgetInput>): Promise<ModelBudget> {
    const res = await this.#host.request<unknown>({
      method: "PATCH",
      path: path`/model-budgets/${id}`,
      body: patch,
    });
    return unwrap<ModelBudget>(res, "budget");
  }

  /** `DELETE /model-budgets/:id` — delete a budget (tenant admin). Resolves to nothing. */
  async deleteBudget(id: string): Promise<void> {
    await this.#host.request<unknown>({ method: "DELETE", path: path`/model-budgets/${id}` });
  }

  /** `GET /model-budgets/:id/usage` — a budget's used/reserved counters. */
  async budgetUsage(id: string): Promise<ModelBudgetUsage> {
    const res = await this.#host.request<ModelBudgetUsage>({
      method: "GET",
      path: path`/model-budgets/${id}/usage`,
    });
    return res.body;
  }

  /**
   * `POST /model-routes` — create a route (`201`).
   *
   * @throws {ApiError} `409 model_route_exists`, `400 invalid_route_name`.
   */
  async createRoute(input: ModelRouteInput, options?: ModelsConsoleOptions): Promise<ModelRoute> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: "/model-routes",
      query: { project: options?.project },
      body: input,
      signal: options?.signal,
    });
    return unwrap<ModelRoute>(res, "route");
  }

  /** `PATCH /model-routes/:name` — edit a route. */
  async updateRoute(
    name: string,
    patch: ModelRoutePatch,
    options?: ModelsConsoleOptions,
  ): Promise<ModelRoute> {
    const res = await this.#host.request<unknown>({
      method: "PATCH",
      path: path`/model-routes/${name}`,
      query: { project: options?.project },
      body: patch,
      signal: options?.signal,
    });
    return unwrap<ModelRoute>(res, "route");
  }

  /**
   * `DELETE /model-routes/:name` — delete a route. Resolves to nothing.
   *
   * @throws {ApiError} `404 model_route_not_found`.
   */
  async deleteRoute(name: string, options?: ModelsConsoleOptions): Promise<void> {
    await this.#host.request<unknown>({
      method: "DELETE",
      path: path`/model-routes/${name}`,
      query: { project: options?.project },
      signal: options?.signal,
    });
  }
}
