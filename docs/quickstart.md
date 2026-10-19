---
key: "quickstart"
title: "Quickstart"
section: "get-started"
description: "Get a token, install a client, and make your first call through w6w — one access point for every API your product runs on."
---

# Quickstart

w6w puts every API your product runs on — the ones you own and the ones you buy — behind one
access point and one credential. This page gets you from nothing to a first real call.

## 1. Get access

w6w isn't self-serve yet. [Request access](/) from the homepage and you'll get back an API token (and a base URL, if your
account lives on its own host) for your account. Calls go to `https://api.w6w.io` by default.

## 2. Install a client

Pick the language your product is in. All three share one version and one set of operations.

```bash
npm install @w6w/sdk       # TypeScript / JavaScript
npm install -g @w6w/cli    # w6w <command>, on top of the same SDK
pip install w6w            # Python
```

## 3. Configure it

The token from step 1 is all you need; the base URL defaults to `https://api.w6w.io`:

```bash
export W6W_TOKEN=…                             # sent as a Bearer token on every call
# export W6W_BASE_URL=https://api.example.com   # optional: only for a different host, no trailing path
```

## 4. Make your first call

```ts
import { W6WClient, isActionRun } from "@w6w/sdk";

const client = new W6WClient(); // reads W6W_TOKEN (and W6W_BASE_URL if set)

const me = await client.me();               // who am I, which versions am I talking to?
const connections = await client.connections.list(); // what can I run?

const result = await client.run({
  urn: connections[0].id, // a conn_… id resolves to an app action
  action: "send_message",
  payload: { channel: "#general", text: "Hello from w6w" },
});
if (isActionRun(result)) console.log(result.value);
```

Same call from the CLI. Save your token once with `w6w auth login <token>` (or export `W6W_TOKEN`):

```bash
w6w connections list
w6w run conn_01H… --action send_message --payload '{"channel":"#general","text":"Hello from w6w"}'
```

`run` also takes a `fn_…` (Function), `ep_…` (Endpoint), or `wf_…` (Workflow) id — same call shape,
no `--action` needed since each of those has exactly one operation.

## Where to next

- **[Browse the apps](https://w6w.io/apps)** — the ready-made integrations, and what each one's actions,
  connections, and health checks look like.
- **[Build a w6w app](/guides/build-a-w6w-app/)** — the full agent-ready guide for authoring a
  new integration as code, if the app you need isn't built yet.
- **The App contract** and **Composition** sections in the rail — the RFCs behind Action, Auth,
  Function, Endpoint, and Workflow, if you want the spec, not just the shape.
