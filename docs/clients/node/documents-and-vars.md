---
id: null
key: "node/documents-and-vars"
title: "Documents and vars"
section: "clients"
description: "Create, read, update and delete documents and vars from the Node SDK, the configuration your workflows read at run time."
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

# Documents and vars

Documents and vars are configuration you keep in w6w instead of in your code, so you can change it
without a deploy. A **document** is a block of text stored under a key, such as an email template
or a prompt. A **var** is a single named, typed value, such as a sender address or a feature flag.
This page shows how to manage both from the Node SDK.

## Before you start

- A working client. See the [Node SDK](/clients/node/) page.

## Documents

### Create a document

```ts
import { W6WClient } from "@w6w/sdk";

const client = new W6WClient();

const doc = await client.documents.create({
  key: "welcome-email",
  content: "# Welcome to the team",
  format: "markdown",
  description: "Body of the welcome email",
});
console.log(doc.id, doc.key);
```

You should see a `doc_…` id and the key you chose. The key must be unique within the project and
at most 128 characters. `format` is a hint for editors and readers: `text` (the default),
`markdown`, `yaml`, `html` or `json`. w6w stores the content as-is whatever the format.

### Read documents

```ts
const all = await client.documents.list();
const byId = await client.documents.get(doc.id);
const byKey = await client.documents.getByKey("welcome-email");
console.log(byKey.content);
```

Read by key when your code knows the name. The SDK encodes the key for you, so keys containing `/`
or spaces work.

### Update and delete a document

`update` changes only the fields you pass:

```ts
await client.documents.update(doc.id, { content: "# Welcome aboard" });
await client.documents.delete(doc.id);
```

### Work in a specific project

Documents belong to a project. Without one, calls use your account's default project. Pick a
project for one call, or for every call the client makes:

```ts
await client.documents.list({ project: "prj_01H…" });

const scoped = new W6WClient({ project: "prj_01H…" }); // default for documents and workflows
```

## Vars

### Create a var

```ts
const v = await client.vars.create({
  name: "sender_email",
  type: "string",
  value: "hello@example.com",
  description: "From-address for outgoing email",
});
console.log(v.id, v.name, v.value);
```

You should see a `var_…` id. Names use lowercase letters, digits and underscores, start with a
letter or underscore, and are at most 64 characters. `type` is `string`, `number`, `boolean` or
`json`, and w6w checks `value` against it:

```ts
await client.vars.create({ name: "max_retries", type: "number", value: 3 });
await client.vars.create({ name: "beta_enabled", type: "boolean", value: false });
await client.vars.create({ name: "regions", type: "json", value: ["eu", "us"] });
```

### Read, update and delete vars

```ts
const vars = await client.vars.list();
const one = await client.vars.getByName("sender_email");

await client.vars.update(one.id, { value: "team@example.com" });
await client.vars.delete(one.id);
```

`update` changes only the fields you pass. Vars belong to your account, not to a project, so none
of these calls take a `project`.

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `409 document_exists` | A document with that key already exists in the project. | Use `getByKey` and `update` it, or choose another key. |
| `409 var_exists` | A var with that name already exists. | Use `getByName` and `update` it. |
| `400 invalid_name` | The var name has capitals, dashes or other characters, or is too long. | Use lowercase letters, digits and underscores only. |
| `400 invalid_value` | The value doesn't match the var's `type`. | Pass a number for `number`, `true` or `false` for `boolean`. |
| `400 invalid_format` | `format` isn't one of the five allowed values. | Use `text`, `markdown`, `yaml`, `html` or `json`. |
| `404 unknown_document` from `getByKey` | No document with that key in this project. | Check the key, and pass `project` if the document lives in another project. |
| `400 unknown_project` | The project id isn't one of your account's projects. | Copy the project id from Studio. |

## Where to next

- **[Workflows, Functions and Endpoints](/clients/node/workflows/)**: run what reads this
  configuration.
- **[Node SDK reference](/clients/node/reference/)**: every method and option.
