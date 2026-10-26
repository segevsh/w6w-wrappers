---
id: null
key: "agents-studio"
title: "Skills, context and agent drafts"
section: "guides"
description: "Read skills, manage context collections and save agent drafts through the SDK, CLI and Python client. Agents are drafts only: nothing runs them yet."
format: "markdown"
shared: true
sourceRepo: null
sourcePath: null
sourceSha: null
sourceRefSha: null
---

# Skills, context and agent drafts

Three groups of operations let you assemble an Agent definition: **skills**
(`/skills`), **context collections** (`/context-collections`) and **agents**
(`/agents`). Per-operation detail is in [endpoints.md](../endpoints.md), §70–§86.

## What exists today

An Agent is a **draft**. Every `agents.*` answer carries `runnable: false`, and
the SDK types it as the literal `false`. **No Agent runtime, no RAG and no chat
history exist yet.** You can save, edit and archive a definition. Nothing in
this group runs one.

An agent _pins_ immutable skill versions and context asset versions. Uploading a
new skill version never changes an existing pin.

## Uploading a skill or context file

There is no `skills.create`. A skill (or context file) is published through the
asset upload flow with `purpose: "skill"` (or `"context"`):

```bash
w6w assets upload --purpose skill ./my-skill
```

The same is available as `assets.uploads.*` in the SDK and Python client. The
`skills.*` operations then read and archive what the upload produced.

## Operations

| Group | Operations |
|---|---|
| `skills` | `list`, `get`, `versions`, `archive` |
| `context` | `list`, `create`, `get`, `update`, `archive` |
| `context.entries` | `list`, `create`, `update` |
| `contextEntries` | `list`, `create`, `get`, `update`, `archive`, `addToCollection`, `removeFromCollection` |
| `agents` | `list`, `create`, `get`, `update`, `archive` |

Every foreign or absent id is the same uniform `404 not_found`.

## Documents without a collection

A context entry does not have to belong to a collection. `contextEntries.*`
(`/context-entries`) works on entries directly: create one with no
`collectionIds`, list across collections, or filter with `collectionId`. An
entry can belong to several collections; `addToCollection` and
`removeFromCollection` change membership. A top-level entry carries
`collectionIds` (sorted), and a pin's `collectionId` is optional. The nested
`context.entries.*` operations are unchanged.

## Model options

An agent can carry `modelOptions`: `temperature`, `topP`, `maxOutputTokens`
and `stop`, all optional. Pass them to `agents.create` or `agents.update` and
read them back on the agent.

## SDK

```ts
const skills = await client.skills.list();
const versions = await client.skills.versions(skills[0].id);

const agent = await client.agents.create({
  name: "Support triage",
  instructions: "Classify the ticket.",
  skills: [{ skillId: skills[0].id, skillVersionId: versions[0].id }],
});
agent.runnable; // false
```

## CLI

```bash
w6w skills list
w6w skills versions <skill-id>
w6w context list
w6w context entries-list <collection-id>
w6w agents list
w6w agents get <agent-id>
w6w agents archive <agent-id>
```

## Python

```python
agent = client.agents.create(name="Support triage", instructions="Classify the ticket.")
current = client.agents.get(agent["id"])
```

## Editing safely: revision and precondition

`agents.update` and `context.entries.update` take two guards:

- the body `revision`, the last revision you saw (a positive integer);
- the `ifUnmodifiedSince` precondition (the `updatedAt` you last saw), sent as
  the `x-w6w-if-unmodified-since` header. In Python it is `if_unmodified_since`;
  in the CLI it is `--if-unmodified-since`.

The server requires the header. Omitting it is `428 precondition_required`,
reported as the typed precondition error, never a silent overwrite. A stale
`revision` or `updatedAt` is `409 conflict`, reported as the typed conflict
error; for `agents.update` it carries `currentRevision`. Re-read the draft, then
retry.

```ts
const a = await client.agents.get(id);
await client.agents.update(id, { revision: a.revision, name: "Renamed" }, {
  ifUnmodifiedSince: a.updatedAt,
});
```

`w6w agents update` prints the conflict message and exits non-zero on a `409`.
`context.update` (the collection patch) has neither guard: last write wins.
Entry listings carry no `revision`; take the token for a first
`context.entries.update` from the create or update answer.

## React

`@w6w/react` exposes `useAgents`, `useAgent`, `useSkills` and
`useContextCollections` and `useContextEntries`, each returning loading, error and data.
