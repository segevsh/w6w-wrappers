---
id: null
key: "node/credentials"
title: "Credentials"
section: "clients"
description: "Create, rotate, disable, test and delete stored credentials from the Node SDK, and attach one to a connection by id."
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

# Credentials

A credential is a secret you store once and reuse. Connections point at it by id, so rotating the
secret updates every connection that uses it. This page shows the Node SDK calls. They live under
`client.console.credentials`, in the console subpath (`@w6w/sdk/console`), not in the stable
operation contract.

```ts
import { W6WClient } from "@w6w/sdk";
import "@w6w/sdk/console";

const client = new W6WClient();

const cred = await client.console.credentials.create({
  name: "Ops mailbox",
  contract: "api_key",
  source: { key: "sk_live_…" },
});

// Attach it: a connection that uses the stored credential by id.
const conn = await client.console.connections.create("sendgrid", {
  authKey: "apiKey",
  credentialId: cred.id,
});
console.log(conn.credentialId === cred.id); // true
```

## Methods

| Call | Does |
| --- | --- |
| `list({ contract?, appId?, authKey? })` | List credentials; only the filters you pass are sent. |
| `get(id)` | Read one credential. |
| `create({ name, contract, source })` | Store a new credential. |
| `update(id, { name })` | Rename it. |
| `rotate(id, { source })` | Replace the secret. |
| `disable(id)` / `enable(id)` | Turn it off and on again. |
| `test(id)` | Probe it. Returns `{ ok, code?, message? }`. A failed probe is `ok: false`, not an error. |
| `dependents(id)` | The connections that use it. |
| `delete(id)` | Delete it. There is no force option. |

## What you never get back

`source` is sent to the server and forwarded as-is. The SDK does not read it, log it or return it,
and no response carries it. A `CredentialSummary` has the id, name, contract, status, revision,
non-secret `display` labels, whether it is `private`, how many connections use it
(`connectionCount`) and its timestamps.

## Deleting a credential that is in use

```ts
import { ApiError } from "@w6w/sdk";

try {
  await client.console.credentials.delete(cred.id);
} catch (err) {
  if (err instanceof ApiError && err.code === "credential_in_use") {
    const raw = err.raw as { error: { dependents: { connections: { id: string }[] } } };
    console.log(raw.error.dependents.connections.map((c) => c.id));
  }
}
```

Detach or delete those connections first.
