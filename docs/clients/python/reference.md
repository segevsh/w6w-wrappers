---
id: null
key: "python/reference"
title: "Python reference"
section: "clients"
description: "Every Client argument, method and error in the w6w Python package, on one page."
format: "markdown"
shared: true
sourceRepo: null
sourcePath: null
sourceSha: null
sourceRefSha: null
sourceUrl: null
syncedAt: null
createdAt: null
updatedAt: null
---

# Python reference

Everything the `w6w` package exports for application code. Import from `w6w`, except
`exchange_token`, which lives in `w6w.server`. For a walkthrough, start with the
[Python](/clients/python/) page.

## `Client(...)`

| Argument | Type | Default | What it does |
| --- | --- | --- | --- |
| `base_url` | `str` | `W6W_BASE_URL` | Your API origin, such as `https://<your-host>`. Must be an absolute `http` or `https` URL. A path is kept as given. |
| `token` | `str` or a callable | `W6W_TOKEN` | A token, or a synchronous callable called before every request, as `token()` or `token(force_refresh=True)`. |
| `project` | `str` | your account's default | Default project for `documents.*`, `workflows.list`, `workflows.create` and `workflows.update`. |
| `refresh_on_unauthorized` | `bool` | `False` | On a `401 unauthorized`, call the token callable with `force_refresh=True` and retry once. |
| `on_unauthorized` | callable | `None` | Called with the final `401` `ApiError`, at most once per call. |
| `headers` | mapping | `None` | Headers sent with every request. Can't override `Authorization`. |
| `transport` | callable | `urllib.request.urlopen` | Takes a `urllib.request.Request` and returns a response. Use it to set a timeout or a proxy. |

`Client()` raises `ConfigError` if there's no usable base URL. A missing token is reported on the
first call instead.

## Client methods

| Method | Returns | Notes |
| --- | --- | --- |
| `me()` | `Me` | `tenant`, `subject`, `account`, `role`, and `versions`, which always holds `"wrapper"` (the client's version). |
| `run(urn, action=None, payload=None)` | `dict` | Runs a `conn_…` action, `fn_…` Function, `ep_…` Endpoint or `wf_…` Workflow. A workflow is queued, not awaited. |
| `request(method, path, query=None, body=None, headers=None)` | `HttpResponse(status, body)` | Calls any route with the client's base URL and token. |

### `run` results

| Check | `kind` | Keys |
| --- | --- | --- |
| `w6w.is_action_run(r)` | `"action"` | `output` (the action's return value; `value` holds the same) |
| `w6w.is_function_run(r)` | `"function"` | `output` |
| `w6w.is_workflow_run(r)` | `"workflow"` | `runId`, `status` (`"queued"`) |

Every result also carries `invocationId`, `startedAt`, `finishedAt` and `durationMs` when the
server records them. Read them with `.get()`.

## `client.connections`

| Method | Returns |
| --- | --- |
| `list()` | `list[ConnectionSummary]`: `id`, `appId`, `displayName`, `state`, `lastTestOk`, `lastTestedAt`, and more |

## `client.workflows`

| Method | Returns | Notes |
| --- | --- | --- |
| `list(project=None)` | `list[WorkflowSummary]` | `id`, `key`, `name`, `displayName`, `status`, `tags`, `runCount`, `updatedAt` |
| `run(id, wait=False, variables=None, trigger=None, input=None)` | `WorkflowRunResult` | `runId`, `status`, `terminal`, `output`, `error`, `stepErrors`, `steps`, `httpStatus`. `id` may be the workflow's key. |
| `cancel(id)` | `dict` | `id`, `status` (the status at that moment), `cancelRequestedAt`. `id` is the run id. |
| `get(id)` | `WorkflowDetail` | `workflow` (the definition), `sourceRef`, `updatedAt` |
| `create(definition, project=None)` | `WorkflowSaveResult` | `id`, `name`, `scheduled`, `updatedAt`. Assigns a `wf_…` id if the definition has none. |
| `update(id, definition, project=None, if_unmodified_since=None)` | `WorkflowSaveResult` | Replaces the whole definition. `409 workflow_stale` if `if_unmodified_since` doesn't match. |
| `archive(id)` | `dict` | Required before `delete`. |
| `delete(id)` | `None` | `409 workflow_not_archived` if it's still active. |

## `client.functions`

| Method | Returns | Notes |
| --- | --- | --- |
| `run(name, payload=None)` | the Function's output | `name` is the key or `fn_…` id. |
| `list()` | `list[FunctionSummary]` | `id`, `key`, `displayName`, `description`, `updatedAt`, `valid` |
| `get(id)` | `FunctionDetail` | `function` (the definition), `valid` |
| `create(definition)` | `SaveResult` | `id`, `key`. Assigns a `fn_…` id if the definition has none. |
| `update(id, definition)` | `SaveResult` | Replaces the whole definition. |
| `delete(id)` | `None` | The Function must be archived first. Archive it with `client.request("POST", w6w.path("/functions/{id}/archive", id=fn_id))`. |

## `client.endpoints`

| Method | Returns | Notes |
| --- | --- | --- |
| `run(name, payload=None)` | `dict` | Same shape as `client.run()`. `name` is the key or `ep_…` id. |

## `client.documents`

Every method takes an optional `project=`.

| Method | Returns |
| --- | --- |
| `list()` | `list[Doc]` |
| `get(id)` | `Doc`: `id`, `key`, `content`, `format`, `description`, `createdAt`, `updatedAt` |
| `get_by_key(key)` | `Doc` |
| `create(key, content, format=None, description=None)` | `Doc` |
| `update(id, content=…, format=…, description=…)` | `Doc`. Only the arguments you pass are changed. |
| `delete(id)` | `None` |

## `client.vars`

| Method | Returns |
| --- | --- |
| `list()` | `list[Var]` |
| `get(id)` | `Var`: `id`, `name`, `type`, `value`, `description`, `createdAt`, `updatedAt` |
| `get_by_name(name)` | `Var` |
| `create(name, type, value, description=None)` | `Var` |
| `update(id, type=…, value=…, description=…)` | `Var`. Only the arguments you pass are changed. |
| `delete(id)` | `None` |

## `client.team`

Reading works for any member. The rest need the `owner` or `admin` role.

| Method | Returns |
| --- | --- |
| `members()` | `list[TeamMember]`: `user_id`, `email`, `display_name`, `role`, `created_at` |
| `invite(email=None, role=None)` | `TeamInviteWithLink`, including `token` and `redemption_link`. Leave out `email` for an open link. |
| `invites()` | `list[TeamInvite]` |
| `revoke_invite(id)` | `None` |
| `set_role(user_id, role)` | `TeamMember`. `role` is `"member"` or `"admin"`. |
| `remove_member(user_id)` | `None` |

## `w6w.server.exchange_token(...)`

For backends only. Trades your tenant's client credentials for a short-lived token for one user.

| Argument | What it is |
| --- | --- |
| `base_url` | Your API origin. |
| `client_id`, `client_secret` | Your tenant's credentials. Keep the secret on your backend. |
| `subject` | Your user's id. |
| `account` | Optional. The w6w account the user works in, from your own records. |
| `transport` | Optional, as on `Client`. |

Returns a dict with `token`, `expiresIn` (seconds) and `user`.

## Errors

| Class | Attributes | Raised when |
| --- | --- | --- |
| `w6w.ConfigError` | `message` | The base URL or token is missing or malformed. No request was sent. |
| `w6w.ApiError` | `status`, `code`, `message`, `raw` | A request failed. `status` is `0` for `network_error`. |

## Helpers

| Export | What it does |
| --- | --- |
| `w6w.path("/documents/by-key/{key}", key=k)` | Builds a request path, percent-encoding each value. |
| `w6w.is_terminal_run_status(status)` | `True` for `succeeded`, `failed` and `canceled`. |
| `w6w.__version__` | The installed version. |

## Where to next

- **[Python](/clients/python/)**: install, authenticate and run your first action.
- **[Node SDK reference](/clients/node/reference/)**: the same operations in TypeScript.
