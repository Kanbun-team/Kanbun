# Kanbun REST API and webhooks

Kanbun has a JSON API under `/api/v1` for scripts, integrations and automation, and outgoing webhooks that tell other systems when cards change. The machine-readable description is [openapi.json](openapi.json) (OpenAPI 3.1), also served by every instance at `/api/v1/openapi.json` without a token.

## Authentication

1. Open **Settings**, section **API tokens**.
2. Give the token a name, pick **Read only** or **Read and write**, and an expiry (never, 30, 90 or 365 days).
3. Copy the token (`kbn_` followed by 64 hex characters). It is shown once; Kanbun keeps only its SHA-256 hash.

Send it in the `Authorization` header:

```sh
export KANBUN=https://kanbun.example.com
export TOKEN=kbn_...
curl -H "Authorization: Bearer $TOKEN" "$KANBUN/api/v1/me"
```

A token acts as its user, with the same permissions: it sees the boards the user is a member of (every board for admins), and board-owner actions (reordering or deleting columns) need a board owner or an admin. It stops working when it is revoked, when it expires, when the user is deactivated, or when an admin resets the user's password (which revokes all of their tokens). Mutations (`POST`, `PATCH`, `DELETE`) need a **Read and write** token; a read-only token gets `403 insufficient_scope`.

The API never reads the session cookie, so it is not exposed to cross-site request forgery, and it sends no CORS headers: call it from servers and scripts, not from web pages on other origins. Creating and revoking tokens is recorded in the audit log (`token.create`, `token.revoke`).

## Resources

| Method | Path | What |
| --- | --- | --- |
| GET | `/me` | The token's user and the token itself |
| GET | `/boards` | Boards you can open (paginated) |
| GET | `/boards/{boardId}` | A board with its columns and tags |
| GET, POST | `/boards/{boardId}/columns` | List columns, add one at the end |
| PATCH, DELETE | `/columns/{columnId}` | Rename, set the WIP limit, move (`position`); delete to the trash |
| GET, POST | `/boards/{boardId}/cards` | List cards (filters below, paginated), create a card |
| GET, PATCH, DELETE | `/cards/{cardId}` | Read, change or move, delete to the trash |
| GET, POST | `/cards/{cardId}/comments` | List comments (oldest first, paginated), add one |
| GET | `/boards/{boardId}/tags` | Tags of a board |

Card filters on `GET /boards/{boardId}/cards`: `column` (column id), `assignee` (user id or username), `tag` (tag id or exact name), `updatedSince` (ISO 8601 date-time).

Changes made through the API behave like the same change in the browser: card history, watchers and notifications, live updates on open boards, the trash (deleted cards and columns can be restored for 30 days) and webhooks.

### Examples

List boards and read one with its columns:

```sh
curl -H "Authorization: Bearer $TOKEN" "$KANBUN/api/v1/boards"
curl -H "Authorization: Bearer $TOKEN" "$KANBUN/api/v1/boards/BOARD_ID"
```

Create a card at the top of a column:

```sh
curl -X POST "$KANBUN/api/v1/boards/BOARD_ID/cards" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"columnId":"COLUMN_ID","title":"Renew the certificate","priority":"high","deadline":"2026-12-31","position":0}'
```

Move it to another column and assign it (`assigneeIds` and `tagIds` replace the whole set):

```sh
curl -X PATCH "$KANBUN/api/v1/cards/CARD_ID" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"columnId":"DONE_COLUMN_ID","assigneeIds":["USER_ID"]}'
```

Cards changed in the last hour that are tagged "Bug":

```sh
curl -G -H "Authorization: Bearer $TOKEN" "$KANBUN/api/v1/boards/BOARD_ID/cards" \
  --data-urlencode "tag=Bug" --data-urlencode "updatedSince=2026-11-18T09:00:00Z"
```

Comment on a card (`@username` mentions notify people):

```sh
curl -X POST "$KANBUN/api/v1/cards/CARD_ID/comments" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"body":"Deployed to staging."}'
```

Deadlines are calendar dates: send and receive `YYYY-MM-DD` (an ISO date-time is accepted and its UTC date used). `null` clears a field. Card `position` 0 is the top of the column; moving to another column without a `position` puts the card at the end.

## Pagination

List endpoints that can grow return a page:

```json
{ "data": [ ... ], "next": "bzo1MA" }
```

`limit` sets the page size (1 to 100, default 50). Pass `next` as `cursor` to get the following page; `next` is `null` on the last page. Treat the cursor as opaque.

```sh
curl -H "Authorization: Bearer $TOKEN" "$KANBUN/api/v1/boards/BOARD_ID/cards?limit=100&cursor=bzo1MA"
```

Columns and tags are returned in one piece as `{ "data": [ ... ] }`.

## Errors

Every error has the same shape and a matching HTTP status:

```json
{ "error": { "code": "validation_failed", "message": "The request body or query is not valid.", "details": [{ "path": "title", "message": "Too small: expected string to have >=1 characters" }] } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | The body is not a JSON object |
| 401 | `unauthorized` | Missing, malformed, unknown, expired or revoked token, or a deactivated user |
| 403 | `forbidden` | No access to the board, or an owner-only action |
| 403 | `insufficient_scope` | A read-only token tried to change something |
| 404 | `not_found` | No such board, column, card or endpoint |
| 413 | `payload_too_large` | Body over 1 MB |
| 415 | `unsupported_media_type` | Body not sent as `application/json` |
| 422 | `validation_failed` | Invalid input; `details` lists the fields |
| 429 | `rate_limited` | Too many requests, see below |
| 500 | `internal_error` | A bug; the server log has the details |

## Rate limits

Each token may make `API_RATE_LIMIT` requests per minute (default 120). Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset` (Unix seconds). Over the limit the API answers `429` with a `Retry-After` header in seconds. Repeated failed authentications from one IP address are limited too (60 per minute).

The limiter is in memory, per process, like the rest of Kanbun's single-process design (`src/lib/limiter.ts`; another store can be plugged in with `setLimiter()`).

## Webhooks

Board owners and admins add webhooks in the board's **Settings**, section **Webhooks**: a payload URL and the events to send. Kanbun shows the signing secret once, when the webhook is added.

Events:

| Event | When |
| --- | --- |
| `card.created` | A card is created (in the board, from a template, from a checklist item, by a schedule or through the API) |
| `card.updated` | Title, description, priority, deadline, assignees or tags change; `changes` lists which |
| `card.moved` | A card is moved or reordered; `from` and `to` name the columns |
| `card.deleted` | A card is moved to the trash |
| `comment.created` | Someone comments on a card; the payload has `comment` |
| `ping` | The **Send test** button |

Each delivery is a `POST` with a JSON body:

```json
{
  "event": "card.moved",
  "id": "0b6f4a8e-1c1f-4a3a-9d0e-5e3f1d2c7a10",
  "deliveredAt": "2026-11-18T10:15:00.000Z",
  "board": { "id": "cm...", "name": "Website relaunch" },
  "card": { "id": "cm...", "boardId": "cm...", "columnId": "cm...", "title": "Responsive navigation", "position": 0, "priority": "high", "deadline": null, "assignees": [], "tags": [], "...": "..." },
  "actor": { "id": "cm...", "username": "marta", "displayName": "Marta Nowak" },
  "from": { "columnId": "cm...", "columnName": "In progress" },
  "to": { "columnId": "cm...", "columnName": "Done" }
}
```

and these headers:

- `X-Kanbun-Event`: the event name
- `X-Kanbun-Delivery`: a unique id per delivery (also `id` in the body), useful to drop duplicates
- `X-Kanbun-Signature`: `sha256=` and the hex HMAC-SHA256 of the raw body, keyed with the signing secret
- `User-Agent`: `Kanbun-Webhook/1.0`

### Verifying the signature

Compute the HMAC over the raw request body (before parsing JSON) and compare in constant time. Node.js with Express:

```js
import crypto from "node:crypto";
import express from "express";

const SECRET = process.env.KANBUN_WEBHOOK_SECRET; // whsec_...
const app = express();

app.post("/hooks/kanbun", express.raw({ type: "application/json" }), (req, res) => {
  const expected = "sha256=" + crypto.createHmac("sha256", SECRET).update(req.body).digest("hex");
  const given = req.get("X-Kanbun-Signature") ?? "";
  const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return res.status(401).end();

  const event = JSON.parse(req.body.toString("utf8"));
  console.log(event.event, event.card?.title);
  res.status(204).end();
});

app.listen(3000);
```

### Delivery, retries and failures

- Deliveries are sent in the background from an in-process queue, so a slow receiver never slows down the person making the change. Queued deliveries are lost if the server restarts.
- Each attempt times out after 10 seconds. A 2xx response counts as delivered; redirects are not followed. Failed attempts are retried up to 3 attempts in total (after 5 and 30 seconds); 4xx answers other than 408 and 429 are not retried.
- After 10 failed deliveries in a row the webhook is switched off. Turn it back on in board settings once the receiver is fixed.
- Board settings list the last 20 deliveries per webhook with the result, status code, duration and attempts.
- Adding and deleting webhooks is recorded in the audit log (`webhook.create`, `webhook.delete`).

### Allowed addresses

Webhook URLs must be `http` or `https`, without user name or password. By default Kanbun refuses to deliver to loopback, private, link-local (including cloud metadata at `169.254.169.254`), carrier-grade NAT, multicast and other reserved addresses, for IPv4 and IPv6. Host names are resolved at delivery time and every address is checked inside the connection, so DNS tricks can not slip past the check.

To post to receivers on your own network (a self-hosted automation server, for example), set `WEBHOOK_ALLOW_PRIVATE=1` in the environment. Only do this if you trust every board owner on the instance, since they could then make the server send requests to internal services.
