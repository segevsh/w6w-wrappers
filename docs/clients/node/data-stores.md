---
id: null
key: "node/data-stores"
title: "Data stores"
section: "clients"
description: "Create data stores, read and write entries, query tables and move CSV in and out from the Node SDK."
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

# Data stores

A data store is a small persistent store your workflows and your own code can share. It comes in
three kinds: `kv` (a value per key), `doc` (a JSON document per key) and `table` (rows with a
schema you define). This page shows how to create stores, read and write entries, query a table
and move CSV in and out from the Node SDK.

## Before you start

- A working client. See the [Node SDK](/clients/node/) page.
- A project to keep the store in. Without one, calls use your account's default project; see
  [Work in a specific project](#work-in-a-specific-project).

## Stores

### Create, read and change a store

```ts
import { W6WClient } from "@w6w/sdk";

const client = new W6WClient();

const store = await client.dataStores.create({
  kind: "table",
  name: "tickets",
  schema: {
    columns: [
      { name: "title", type: "string", required: true },
      { name: "status", type: "string", required: true },
    ],
  },
});

const page = await client.dataStores.list({ kind: "table", limit: 20 });
console.log(page.items.length, page.nextCursor);

const same = await client.dataStores.get(store.id);
await client.dataStores.update(store.id, { description: "Support tickets" });
await client.dataStores.archive(store.id);
```

`create` takes a `kind` and a `name`; `description` and `schema` are optional, and `schema` applies
to tables only. `update` changes `name`, `description` or `schema`, and leaves an omitted field alone.
`kind` cannot change. `list` returns the whole page, `{ items, nextCursor }`; pass `nextCursor` back
as `cursor` for the next page. `nextCursor` is absent on the last page.

`archive` is a soft delete and returns nothing. The store then answers `404 data_store_not_found`,
the same answer as a store that never existed or belongs to someone else.

## Entries

### Set, read and delete an entry

```ts
const id = "ds_01H…";

const entry = await client.dataStores.entries.set(id, "greeting", { value: "hello" });
const read = await client.dataStores.entries.get(id, "greeting");
const page = await client.dataStores.entries.list(id, { prefix: "gree", limit: 50 });
await client.dataStores.entries.delete(id, "greeting");
```

`entries.list` returns entries ordered by key, `{ items, nextCursor }`. `prefix` keeps keys that
start with it. A missing key is `404 entry_not_found`. `delete` returns nothing.

### Insert a row, count with increment

```ts
await client.dataStores.entries.insert(id, { title: "Printer on fire", status: "open" });
await client.dataStores.entries.increment(id, "visits", 1);
```

`insert` is for table stores; the server generates the key. `increment` adds atomically. A missing
key starts from 0, and omitting `by` adds 1. Both take an optional `ttlSeconds` where the input has
one.

### Guard a write with `ifVersion`

Every entry carries a `version`. Pass it back as `ifVersion` and the write only happens if nobody
changed the entry since you read it:

```ts
import { ApiError } from "@w6w/sdk";

const current = await client.dataStores.entries.get(id, "greeting");
try {
  await client.dataStores.entries.set(id, "greeting", {
    value: "hi",
    ifVersion: current.version,
  });
} catch (err) {
  if (err instanceof ApiError && err.code === "version_conflict") {
    // someone else wrote first: read again and retry
  } else throw err;
}
```

A stale `ifVersion` is `409 version_conflict`.

## Query a table

```ts
const open = await client.dataStores.entries.query(id, {
  where: { status: "open" },
  order: "title",
  limit: 50,
});
console.log(open.items);
```

`query` is the same route as `entries.list` in query mode. Each `where` column goes out as one
`where[<column>]=<value>` parameter, and `order` names the column to sort by. The answer is `{ items }`
only: there is no `nextCursor` and no `prefix` here. A malformed filter is `400 invalid_query`.

## CSV in and out

```ts
const csv = "title,status\nPrinter on fire,open\nNo wifi,open\n";

const { imported } = await client.dataStores.importCsv(id, csv);
const text = await client.dataStores.exportCsv(id);
```

CSV travels as text, not JSON. `importCsv` sends your string verbatim with
`content-type: text/csv`; the first row names the columns. `exportCsv` returns the CSV as a string,
and never parses it, even if it happens to look like JSON. Both work on table stores.

## Work in a specific project

Data stores belong to a project. Without one, calls use your account's default project. Pass
`project` per call, or set it on the client:

```ts
await client.dataStores.list({ project: "prj_01H…" });
const scoped = new W6WClient({ project: "prj_01H…" });
```

## Errors

Every failure is an `ApiError` with `status` and `code`. The codes below are informational: read
`code`, not the message.

| Status and code | When |
| --- | --- |
| `400 invalid_value` | A value, row or cell the store's kind or schema refuses. Carries `field`, `row` and `column` where they apply. |
| `400 invalid_key` | The entry key is not allowed. |
| `400 invalid_query` | A malformed `where` or `order`. |
| `400 invalid_csv` | The import body was not sent as `text/csv`, or is not valid CSV. |
| `400 unknown_project` | The project id isn't one of your account's projects. |
| `404 data_store_not_found` | No such store, or it is archived or belongs to another account or project. |
| `404 entry_not_found` | No entry under that key. |
| `409 store_exists` | A store with that name already exists. |
| `409 version_conflict` | `ifVersion` is stale. |
| `500 internal_error` | Something failed on the server. |

For `invalid_value`, `field`, `row` and `column` sit in the response envelope, which the SDK keeps
on `ApiError.raw`:

```ts
try {
  await client.dataStores.importCsv(id, csv);
} catch (err) {
  if (err instanceof ApiError && err.code === "invalid_value") {
    const detail = (err.raw as { error?: { field?: string; row?: number; column?: string } })?.error;
    console.log(detail?.row, detail?.column, detail?.field);
  }
}
```

## Other languages

| Node | Python | CLI |
| --- | --- | --- |
| `client.dataStores.list` | `client.data_stores.list` | `w6w data-stores list` |
| `client.dataStores.get` | `client.data_stores.get` | `w6w data-stores get` |
| `client.dataStores.create` | `client.data_stores.create` | `w6w data-stores create` |
| `client.dataStores.update` | `client.data_stores.update` | `w6w data-stores update` |
| `client.dataStores.archive` | `client.data_stores.archive` | `w6w data-stores archive` |
| `client.dataStores.importCsv` | `client.data_stores.import_csv` | `w6w data-stores import` |
| `client.dataStores.exportCsv` | `client.data_stores.export_csv` | `w6w data-stores export` |
| `client.dataStores.entries.list` | `client.data_stores.entries.list` | `w6w data-stores entry-list` |
| `client.dataStores.entries.get` | `client.data_stores.entries.get` | `w6w data-stores entry-get` |
| `client.dataStores.entries.set` | `client.data_stores.entries.set` | `w6w data-stores entry-set` |
| `client.dataStores.entries.insert` | `client.data_stores.entries.insert` | `w6w data-stores entry-insert` |
| `client.dataStores.entries.increment` | `client.data_stores.entries.increment` | `w6w data-stores entry-increment` |
| `client.dataStores.entries.delete` | `client.data_stores.entries.delete` | `w6w data-stores entry-delete` |
| `client.dataStores.entries.query` | `client.data_stores.entries.query` | `w6w data-stores entry-query` |

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `404 data_store_not_found` for a store you just made | The store lives in another project. | Pass the same `project` you created it with. |
| `409 version_conflict` | The entry changed since you read it. | Read it again and retry with the new `version`. |
| `400 invalid_csv` | The CSV was JSON-encoded or sent with another media type. | Use `importCsv` with the raw text; don't call `JSON.stringify` on it. |
| `query` returns no `nextCursor` | Query mode never pages. | Narrow it with `where` and `limit`. |

## Where to next

- **[Documents and vars](/clients/node/documents-and-vars/)**: the configuration your workflows read.
- **[Node SDK reference](/clients/node/reference/)**: every method and option.
