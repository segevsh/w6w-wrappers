---
id: null
key: "node/models"
title: "Models"
section: "clients"
description: "List the model catalog, read model routes, run a completion through a route and query model usage from the Node SDK."
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

# Models

w6w keeps a catalog of AI models and lets you call them through **model routes**: named entry
points that pick the model, the provider and the fallbacks for you. This page shows how to read the
catalog, read routes, run a completion and query usage from the Node SDK.

## Before you start

- A working client. See the [Node SDK](/clients/node/) page.
- At least one model route in your project. Routes are created and edited with the
  `client.console.models` group, which is not part of the stable surface; see the
  [console reference](https://github.com/w6w-io/w6w-wrappers/blob/main/node/docs/console.md).

## Models

### List and read the catalog

```ts
import { W6WClient } from "@w6w/sdk";

const client = new W6WClient();

const page = await client.models.list({ provider: "openai", limit: 20 });
console.log(page.models.length, page.nextCursor);

const model = await client.models.get(page.models[0].id);
```

`list` returns the whole page, `{ models, nextCursor }`. Pass `nextCursor` back as `cursor` to read
the next page. `provider`, `status` and `limit` narrow the list.

## Model routes

### Read routes

```ts
const routes = await client.modelRoutes.list();
const route = await client.modelRoutes.get("summarize");
```

### Run a completion

```ts
const result = await client.modelRoutes.complete(
  "summarize",
  { messages: [{ role: "user", content: "Summarize this ticket." }] },
  { dialect: "openai", response: "both" },
);
console.log(result.invocationId, result.status);
```

`complete` POSTs your input to `/model-routes/{name}/complete` and returns the flat envelope
exactly as the server sent it, including `invocationId`, `status` and `key`. The SDK does not
unwrap it to `output`. Two options shape the call:

- `dialect`: the wire format your input and the provider reply use: `openai`, `anthropic` or
  `ollama`.
- `response`: how much comes back: `output` (the model's answer), `raw` (the provider's reply) or
  `both`.

## Usage

```ts
const report = await client.modelUsage.query({
  groupBy: "route",
  from: "2026-10-01",
  to: "2026-10-24",
  limit: 50,
});
```

`groupBy` is `route`, `model` or `day`. `from`, `to`, `route`, `model`, `limit` and `cursor`
filter and page the report.

## Work in a specific project

Routes and usage belong to a project. Without one, calls use your account's default project. Pass
`project` per call, or set it on the client:

```ts
await client.modelRoutes.list({ project: "prj_01H…" });
const scoped = new W6WClient({ project: "prj_01H…" });
```

## Other languages

| Node | Python | CLI |
| --- | --- | --- |
| `models.list` / `models.get` | `models.list` / `models.get` | `w6w models ls` / `w6w models get` |
| `modelRoutes.list` / `get` | `model_routes.list` / `get` | `w6w model-routes list` / `get` |
| `modelRoutes.complete` | `model_routes.complete` | `w6w model-routes complete <name>` |
| `modelUsage.query` | `model_usage.query` | `w6w model-usage` |

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `404` from `modelRoutes.get` or `complete` | No route with that name in this project. | Check the name, and pass `project` if the route lives in another project. |
| `400 unknown_project` | The project id isn't one of your account's projects. | Copy the project id from Studio. |
| `complete` result has no `output` field | `response` was `raw`. | Use `response: "output"` or `"both"`. |

## Where to next

- **[Documents and vars](/clients/node/documents-and-vars/)**: the configuration your prompts read.
- **[Node SDK reference](/clients/node/reference/)**: every method and option.
