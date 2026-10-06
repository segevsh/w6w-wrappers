---
id: null
key: "http"
title: "Raw HTTP"
section: "clients"
description: "Call w6w with no SDK: base URL, bearer token, the error envelope, and one GET and one POST."
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

# Raw HTTP

Every w6w client wraps the same HTTP API. If your language has no client yet, or you only need one
call, you can talk to it directly. The [Node SDK](/clients/node/) also exposes `client.request()` for
routes it doesn't wrap.

## Base URL and token

- **Base URL**: your w6w host, for example `https://api.example.com`. Routes sit directly under it,
  with no path prefix, so the identity route is `https://api.example.com/auth/me`.
- **Authentication**: bearer. Send your token in the `Authorization` header on every request.

```bash
export W6W_BASE_URL="https://api.example.com"
export W6W_TOKEN="<your token>"
```

## A GET: list workflows

`GET /workflows` returns the workflow definitions you can see. An optional `project` query
parameter narrows the list.

```bash
curl -sS "$W6W_BASE_URL/workflows" \
  -H "Authorization: Bearer $W6W_TOKEN"
```

To check who the token belongs to, call `GET /auth/me` the same way.

## A POST: invoke a Function

`POST /functions/{idOrKey}/invoke` runs a Function by its id or key. The body is an object with an
optional `inputs` object, and a successful call answers `200`.

```bash
curl -sS -X POST "$W6W_BASE_URL/functions/my-function/invoke" \
  -H "Authorization: Bearer $W6W_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"name": "Ada"}}'
```

To run anything by its URN instead, `POST /run` takes a body with a required `urn`, and optional
`action` and `payload`. It answers `200`, or `202` when the run continues in the background.

## Errors

A failed request answers with a non-2xx status and a JSON body in this shape:

```json
{ "error": { "code": "string", "message": "string" } }
```

Branch on the HTTP status first, then on `error.code`. Show `error.message` to a person.

## The full list

This page covers the shape of a call. Every route, with its parameters and responses, is in the
[HTTP API reference](/reference-api/http-api/).
