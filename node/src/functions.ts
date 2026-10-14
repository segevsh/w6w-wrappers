/**
 * `client.functions.*` — run a Function by the name you gave it.
 *
 * A Function is a canonical, vendor-stable interface bound to one swappable app
 * Action. Before this namespace existed, calling one meant the URN operation:
 *
 * ```ts
 * await client.run({ urn: "fn_a9b39917-cd4e-4eea-ab89-c3d079684193", payload });
 * ```
 *
 * — an opaque id, buried inside an object, for a Function the user named
 * `send-email`. `client.run` is still the right tool when the caller is
 * *dispatching* something whose kind it does not know; it is the wrong tool for
 * "call my send-email Function", which is what this is:
 *
 * ```ts
 * await client.functions.run("send-email", { payload: { to, subject, html } });
 * ```
 *
 * The name is the FIRST argument, matching `workflows.run(id, opts?)` — the
 * namespace already shaped this way — so all three runnable kinds read alike.
 *
 * ── The rest of the namespace ──
 * `list`, `get`, `create`, `update` and `delete` complete the definition
 * lifecycle, mirroring `client.workflows.*` op for op with one difference the
 * server dictates, not this package: there is no `?project=` anywhere on this
 * domain. `archive` is the required step before `delete`, and the version
 * methods (`listVersions` … `runVersion`) match `client.workflows.*`.
 *
 * The server has ONE write route (`POST /functions`, an upsert), so `create`
 * and `update` are the same request shaped differently — `create` mints the
 * required `id`, `update` pins the one you addressed — and `update` is a full
 * replacement rather than a patch.
 *
 * ID OR KEY, one argument. The server's `/functions/{idOrKey}/invoke` accepts
 * either, because the two shapes cannot collide: an id carries a kind prefix and
 * therefore an underscore, and a key is kebab-case, which forbids one. So this
 * takes no flag and no prefix to say which you meant — pass whichever you have.
 */
import type { ResolvedConfig } from "./config.ts";
import { ApiError } from "./errors.ts";
import { type CallOptions, type HttpResponse, path, type RequestOptions } from "./http.ts";
import { type FunctionSummary, mintId, unwrap } from "./types.ts";
import {
  getVersion,
  listVersions,
  type PublishResult,
  publishVersion,
  type RevertResult,
  revertVersion,
  setEnabled,
  type VersionDetail,
  type VersionList,
  versionRunPath,
} from "./versions.ts";

/**
 * What this namespace needs from the client — the same narrow seam
 * `WorkflowsApi` takes, so it is constructible in a test and this module never
 * imports the client back.
 */
export interface FunctionsHost {
  /** The resolved configuration. */
  readonly config: ResolvedConfig;
  /** Perform one request. */
  request<T>(options: RequestOptions): Promise<HttpResponse<T>>;
}

/** Per-call options for `functions.run`. */
export interface FunctionRunOptions {
  /**
   * The Function's canonical inputs, by input key.
   *
   * Named `payload` rather than `inputs` so every runnable kind in this SDK
   * takes the same word — the wire spells it `inputs` for a Function and
   * `input` for an Endpoint, and reconciling that is exactly the job of a
   * wrapper. Defaults to `{}` rather than being omitted: the server's parameter
   * schemas are written against an object, and `{}` says "no input" where an
   * absent key says "I forgot".
   */
  payload?: Record<string, unknown>;
  /**
   * Run the **stored** definition even though it was never published — the draft
   * run. A disabled one is still refused.
   *
   * It runs the row exactly as last saved, never a definition you submit here,
   * so save first. Sent as `allowUnpublished: true` in the body **only when
   * `true`**; `false` is the same as omitting it. Not accepted by
   * {@linkcode FunctionsApi.runVersion}.
   */
  allowUnpublished?: boolean;
}

/** Per-call options for `functions.runVersion`: `payload` only. */
export type FunctionRunVersionOptions = Pick<FunctionRunOptions, "payload">;

/**
 * A Function definition — kept OPAQUE, for the same reason `WorkflowDefinition`
 * (`./workflows.ts`) is.
 *
 * The interesting field is `impl`, and it is a union the server extends: an app
 * Action today, another Function or a Workflow since D-8 (`rfcs/function.md`).
 * A wrapper that modelled it would reject an arm a newer server accepts, and
 * the whole point of a Function is that `impl` is the part you swap. Callers
 * bind to `inputs`/`output`; this package carries the definition, it does not
 * interpret it.
 *
 * The one field read here is `id`, in {@linkcode FunctionsApi.create}.
 */
export type FunctionDefinition = Record<string, unknown>;

/** What `functions.get` returns: the stored definition, plus the server's own verdict on it. */
export interface FunctionDetail {
  /** The stored definition, verbatim. */
  function: FunctionDefinition;
  /**
   * Whether the Function can be run — **a top-level sibling, never a field
   * inside `function`**, and this method keeps it there rather than splicing
   * it in. It is computed per request, it is not part of the stored document
   * (`rfcs/function.md`), and folding it into the definition would put it in
   * the object a caller sends back to {@linkcode FunctionsApi.update}.
   */
  valid: boolean;
}

/**
 * The `functions` namespace on a `W6WClient`.
 *
 * @example
 * ```ts
 * const output = await client.functions.run("send-email", {
 *   payload: { to: "ada@example.com", subject: "Hi", html: "<p>Hello</p>" },
 * });
 *
 * // The definition lifecycle.
 * const fns = await client.functions.list();
 * const { function: def } = await client.functions.get(fns[0].id);
 * await client.functions.update(fns[0].id, { ...def, description: "Send an email" });
 * ```
 */
export class FunctionsApi {
  readonly #host: FunctionsHost;

  /**
   * @param host - The client this namespace issues requests through.
   */
  constructor(host: FunctionsHost) {
    this.#host = host;
  }

  /**
   * Run one Function and return its output.
   *
   * Returns the Function's OUTPUT, not an envelope. `client.run` returns a
   * `kind`-discriminated envelope because the caller does not know what the URN
   * will resolve to; here the kind is in the method name, so the discriminant
   * would be a field the caller has to unwrap to learn nothing.
   *
   * @param name - The Function's key (`"send-email"`) or its `fn_…` id. Percent-encoded into the path.
   * @param options - `payload`, the Function's canonical inputs.
   * @returns The Function's output, unwrapped from the `output` envelope.
   * @throws {ApiError} `404 unknown_function` when no Function of that name exists for the caller.
   * @throws {ApiError} `422 function_incomplete` when the Function has no runnable `impl`.
   * @throws {ApiError} `bad_response` when a success body carries no `output` key at all.
   */
  async run(name: string, options?: FunctionRunOptions): Promise<unknown> {
    return await this.#invoke(path`/functions/${name}/invoke`, options);
  }

  /**
   * The one POST both {@linkcode run} and {@linkcode runVersion} go through, so
   * the output guard cannot drift between them.
   *
   * @param invokePath - The already-encoded path.
   * @param options - The run options as given by the public method.
   * @returns The Function's output.
   */
  async #invoke(invokePath: string, options?: FunctionRunOptions): Promise<unknown> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: invokePath,
      body: {
        inputs: options?.payload ?? {},
        // Present only when `true`, like `workflows.run`'s `wait`.
        ...(options?.allowUnpublished === true ? { allowUnpublished: true } : {}),
      },
    });

    // Deliberately NOT `unwrap(res, "output")`. That helper treats `null` as
    // "the server did not send what it promised" — correct for a `documents` or
    // `vars` envelope, where null is never a document. It is wrong here: a
    // Function's output is an OPAQUE pass-through, and an action that returns
    // nothing yields `{"output": null}`, which is a successful run and not a
    // malformed response. So the guard is PRESENCE of the key, not truthiness
    // of the value.
    const body = res.body;
    if (typeof body !== "object" || body === null || !("output" in body)) {
      throw new ApiError(
        res.status,
        "bad_response",
        `Server returned a ${res.status} with no "output" in the response body.`,
        body,
      );
    }
    return (body as { output: unknown }).output;
  }

  /**
   * List the caller's Function definitions.
   *
   * This is how a caller discovers a `key` to pass to {@linkcode run} — the
   * same job `workflows.list` and `connections.list` do for their own ids (D4),
   * and the reason a read-only integration needs no other write access.
   *
   * Each row already carries `valid`, computed server-side; there is no second
   * call to make to find out whether a Function is runnable.
   *
   * **No `project` parameter.** Unlike workflows and documents, the route reads
   * no `?project=` at all (`admin/functions.ts`) — sending one would be
   * inventing a parameter, which is the failure mode `endpoints.json` warns
   * about.
   *
   * @param options - Optional per-call transport options (`signal` to abort).
   * @returns The Functions, unwrapped from the `functions` envelope.
   * @throws {ApiError} On any non-2xx.
   */
  async list(options?: CallOptions): Promise<FunctionSummary[]> {
    const res = await this.#host.request<unknown>({
      method: "GET",
      path: "/functions",
      signal: options?.signal,
    });
    return unwrap<FunctionSummary[]>(res, "functions");
  }

  /**
   * Fetch one Function's stored definition.
   *
   * Returns the whole body — `{function, valid}` — rather than splicing `valid`
   * into the definition. See {@linkcode FunctionDetail.valid} for why that
   * placement matters on the way back OUT of this method.
   *
   * @param id - The `fn_…` id, or the Function's `key`. Percent-encoded into the path.
   * @param options - Optional per-call transport options (`signal` to abort).
   * @returns The definition and the server's runnability verdict.
   * @throws {ApiError} `404 unknown_function` when there is no such Function for this caller.
   */
  async get(id: string, options?: CallOptions): Promise<FunctionDetail> {
    const res = await this.#host.request<FunctionDetail>({
      method: "GET",
      path: path`/functions/${id}`,
      signal: options?.signal,
    });
    return res.body;
  }

  /**
   * Create a Function.
   *
   * **The id is minted client-side when the definition does not carry one** —
   * `POST /functions` requires `id` and never generates one, exactly as the
   * workflow route does. `key` is NOT minted: it is the name the Function is
   * called by, so it is the caller's to choose, and the server validates it on
   * first save only (3–39 chars, lowercase, single hyphens, no `_`). That
   * grammar is what keeps `/functions/{idOrKey}/invoke` unambiguous — a key
   * containing `_` could be mistaken for an `fn_…` id.
   *
   * `create` and {@linkcode update} reach the SAME upsert route; posting a
   * definition whose id already exists overwrites it.
   *
   * @param definition - The whole Function definition, forwarded verbatim apart from a minted `id`.
   * @returns The new Function's id and key.
   * @throws {ApiError} `400 invalid_function` — no `key`, no `inputs` array, or a malformed `impl`.
   * @throws {ApiError} `409 function_conflict` — another `(tenant, subject)` already owns that id.
   * @throws {ApiError} `409 function_key_conflict` — that `key` is already taken in this scope.
   */
  async create(definition: FunctionDefinition): Promise<{ id: string; key: string }> {
    const body = typeof definition.id === "string" && definition.id.length > 0
      ? definition
      : { ...definition, id: mintId("fn") };
    return await this.#save(body);
  }

  /**
   * Overwrite a Function's stored definition.
   *
   * **A full replacement, not a patch** — the server has one write route and it
   * stores what it is given, so read with {@linkcode get}, change what you mean
   * to change, and send the whole thing back. There is no concurrency
   * precondition on this route (workflows have one; Functions do not), so the
   * write is last-write-wins.
   *
   * `id` comes from the FIRST ARGUMENT and is pinned into the body, overriding
   * any `id` the definition carries — otherwise `update("fn_a", defOfB)` would
   * quietly write to B.
   *
   * Do not send back the `valid` field: it is not part of the stored document,
   * and {@linkcode get} deliberately leaves it outside the definition so that
   * a read-modify-write round trip cannot pick it up by accident.
   *
   * @param id - The `fn_…` id to write to.
   * @param definition - The whole replacement definition.
   * @returns The Function's id and key.
   * @throws {ApiError} `400 invalid_function` — structurally invalid body.
   * @throws {ApiError} `409 function_conflict` — another `(tenant, subject)` owns this id.
   * @throws {ApiError} `409 function_key_conflict` — the new `key` is already taken in this scope.
   */
  async update(
    id: string,
    definition: FunctionDefinition,
  ): Promise<{ id: string; key: string }> {
    return await this.#save({ ...definition, id });
  }

  /**
   * Archive a Function.
   *
   * One-way: there is no unarchive route. Idempotent — archiving an
   * already-archived Function re-returns it unchanged. This is a required step,
   * not a convenience: {@linkcode delete} refuses a Function that is not
   * archived (`409 function_not_archived`).
   *
   * @param id - The `fn_…` id.
   * @returns The archived definition, unwrapped from its `function` envelope.
   * @throws {ApiError} `404 unknown_function` when there is no such id.
   */
  async archive(id: string): Promise<FunctionDefinition> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: path`/functions/${id}/archive`,
    });
    return unwrap<FunctionDefinition>(res, "function");
  }

  /**
   * List a Function's published versions (metadata only).
   *
   * @param id - The `fn_…` id.
   * @returns `enabled`, `currentPublishedVersion` (`null` before the first publish) and `versions[]`.
   * @throws {ApiError} `404 unknown_function` when there is no such id.
   */
  async listVersions(id: string): Promise<VersionList> {
    return await listVersions(this.#host, "functions", id);
  }

  /**
   * Read one published version, with its definition.
   *
   * @param id - The `fn_…` id.
   * @param n - The 1-based version number.
   * @returns The version, unwrapped from its `version` envelope.
   * @throws {ApiError} `404 unknown_version` / `404 unknown_function`; `400 invalid_version` for a non-positive `n`.
   */
  async getVersion(id: string, n: number): Promise<VersionDetail> {
    return await getVersion(this.#host, "functions", id, n);
  }

  /**
   * Publish the Function's **stored** definition as a new immutable version.
   *
   * It snapshots what the server has saved, so flush any pending save first.
   * The server takes no precondition.
   *
   * @param id - The `fn_…` id.
   * @returns The new version and `currentPublishedVersion`, as the server sent them.
   * @throws {ApiError} `404 unknown_function` when there is no such id.
   */
  async publish(id: string): Promise<PublishResult> {
    return await publishVersion(this.#host, "functions", id);
  }

  /**
   * Rewrite the live Function from a published version. Does not publish.
   *
   * Saves remain last-write-wins: Functions have no concurrency precondition.
   *
   * @param id - The `fn_…` id.
   * @param n - The version to restore.
   * @returns The `reverted` object, unwrapped from its envelope.
   * @throws {ApiError} `404 unknown_version` / `404 unknown_function`; `400 invalid_version`.
   */
  async revert(id: string, n: number): Promise<RevertResult> {
    return await revertVersion(this.#host, "functions", id, n);
  }

  /**
   * Allow invocations of this Function. Idempotent. Returns nothing.
   *
   * @param id - The `fn_…` id.
   * @throws {ApiError} `404 unknown_function` when there is no such id.
   */
  async enable(id: string): Promise<void> {
    await setEnabled(this.#host, "functions", id, true);
  }

  /**
   * Refuse invocations of this Function (`422 function_disabled`). Idempotent. Returns nothing.
   *
   * @param id - The `fn_…` id.
   * @throws {ApiError} `404 unknown_function` when there is no such id.
   */
  async disable(id: string): Promise<void> {
    await setEnabled(this.#host, "functions", id, false);
  }

  /**
   * Run one published version of a Function rather than the live row.
   *
   * Same output unwrapping as {@linkcode run}; the wire verb is `invoke`.
   *
   * @param id - The `fn_…` id, or the Function's `key`.
   * @param n - The version to run.
   * @param options - `payload`, the Function's canonical inputs.
   * @returns The Function's output.
   * @throws {ApiError} `404 unknown_version` / `404 unknown_function`; `422 function_incomplete` / `function_disabled` / `function_not_published`; `400 invalid_version`.
   */
  async runVersion(
    id: string,
    n: number,
    options?: FunctionRunVersionOptions,
  ): Promise<unknown> {
    return await this.#invoke(versionRunPath("functions", id, n), { payload: options?.payload });
  }

  /**
   * Delete an archived Function.
   *
   * **Archive first.** A Function that is not archived is `409
   * function_not_archived`, which this method does NOT catch and retry through
   * {@linkcode archive}.
   *
   * Not idempotent, and deliberately so: deleting an id that is not there is
   * `404 unknown_function`, not a silent success — the same pin
   * `documents.delete` carries.
   *
   * **Nothing checks for callers first.** A Function may be referenced by an
   * Endpoint, by a Workflow step, or by another Function's `impl` (D-8), and
   * the server does not walk those references; they break at call time. Deleting
   * a Function that something else calls is the caller's decision to get right.
   *
   * Returns nothing: the server's `{ok: true}` carries no information a caller
   * can use (`docs/implementation.md` §5).
   *
   * @param id - The `fn_…` id, or the Function's `key`.
   * @throws {ApiError} `404 unknown_function` when there is no such Function for this caller.
   * @throws {ApiError} `409 function_not_archived` when it exists but has not been archived yet.
   */
  async delete(id: string): Promise<void> {
    await this.#host.request<unknown>({ method: "DELETE", path: path`/functions/${id}` });
  }

  /**
   * The one POST both {@linkcode create} and {@linkcode update} go through.
   *
   * Private and shared rather than duplicated: the route answers `201` with the
   * id and key under a `function` envelope, and two copies of that unwrap is
   * two places for a server change to be half-applied.
   *
   * @param body - The complete definition, id already resolved.
   * @returns The saved Function's id and key.
   */
  async #save(body: FunctionDefinition): Promise<{ id: string; key: string }> {
    const res = await this.#host.request<unknown>({
      method: "POST",
      path: "/functions",
      body,
    });
    return unwrap<{ id: string; key: string }>(res, "function");
  }
}
