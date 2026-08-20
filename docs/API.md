# Metra Public API — v1

Read-only REST access to your organization's Metra data, for integrations and
reporting. JSON over HTTPS.

- **Base URL:** `https://metra-web.nabil-hakeem22.workers.dev/api/v1`
- **Version:** `v1` (read-only). Write endpoints are planned for `v2`.
- **Machine-readable spec:** [`/api/v1/openapi.json`](https://metra-web.nabil-hakeem22.workers.dev/api/v1/openapi.json) (OpenAPI 3)

> The base host is the current testing deployment. When Metra moves to a custom
> domain the path (`/api/v1/...`) stays the same; only the host changes.

---

## Authentication

Every request must carry an API key as a Bearer token:

```
Authorization: Bearer mtk_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

### Getting a key

An **owner or admin** mints keys in the app under **Settings → API keys**. The
raw key (prefix `mtk_`) is shown **once, at creation** — copy it then; Metra
stores only a hash and can never show it again. Lost keys are revoked and
replaced, not recovered.

### What a key can see

A key acts with **the live role of the member who created it**:

- Data is scoped to that member's organization — a key can never read another
  organization's data.
- The key's permissions track the creator's **current** role. If the creator is
  demoted, the key's access narrows on the next request; if the creator is
  removed from the organization, the key stops working (`401`).
- **Cost and margin fields** (`default_unit_cost`, `unit_cost`, `line_margin`,
  `total_cost`, `total_margin`) are included **only** if the creator's role is
  allowed to see margin (the same rule as in the app). Keys created by roles that
  can't see cost receive responses with those fields omitted entirely.

### Auth failures

Missing, malformed, unknown, revoked, or expired keys return `401` with a
[problem](#errors) document. Keep keys secret — treat them like passwords, never
commit them to source control or embed them in client-side code.

---

## Conventions

| | |
|---|---|
| **Format** | `application/json` request/response; errors are `application/problem+json`. |
| **Field names** | `snake_case`. |
| **IDs** | UUID v4 strings, stable across requests. |
| **Money** | String, always **two decimal places**, e.g. `"1250.00"`. EGP throughout v1. Strings (not floats) to preserve precision. |
| **Percentages** | String with two decimals, e.g. `"10.00"` means 10%. |
| **Quantities** | String numeric, e.g. `"4"` or `"2.5"`. |
| **Dates** | Calendar dates as `YYYY-MM-DD`; timestamps as RFC 3339 UTC, e.g. `2026-08-20T09:30:00.000000Z`. |
| **Numerals** | Latin digits in all locales. |
| **Bilingual text** | Arabic and English are separate fields (`name_ar` / `name_en`), either may be `null`. |

---

## Pagination

List endpoints are cursor-paginated and return a stable, newest-first page:

```json
{ "data": [ ... ], "next_cursor": "eyJ0IjoiMjA..." }
```

| Query param | Default | Notes |
|---|---|---|
| `limit` | `25` | Rows per page. Values above `100` are clamped to `100`; invalid values fall back to `25`. |
| `cursor` | — | Opaque token from a previous response's `next_cursor`. |

- Follow `next_cursor` until it is `null` — that's the last page.
- Cursors are opaque; do not construct or mutate them. A malformed cursor returns
  `400 invalid-cursor`.
- Ordering is stable even when rows share a timestamp, so paging never skips or
  repeats a row.

```bash
# first page
curl -s "$BASE/clients?limit=50" -H "Authorization: Bearer $KEY"
# next page
curl -s "$BASE/clients?limit=50&cursor=eyJ0IjoiMjA..." -H "Authorization: Bearer $KEY"
```

---

## Errors

Errors use [RFC 7807](https://www.rfc-editor.org/rfc/rfc7807) `problem+json`:

```json
{
  "type": "https://api.metra.app/problems/unauthorized",
  "title": "Unauthorized",
  "status": 401,
  "detail": "A valid Bearer API key is required."
}
```

| `type` (suffix) | HTTP | Meaning |
|---|---|---|
| `unauthorized` | 401 | Missing / malformed / unknown / revoked / expired key. |
| `forbidden` | 403 | Authenticated, but the key's role may not perform this. |
| `not-found` | 404 | No such resource in your organization (also returned for another org's id — never distinguished from "doesn't exist"). |
| `bad-request` | 400 | Malformed request/parameters. |
| `invalid-cursor` | 400 | The `cursor` value is not a valid pagination token. |
| `rate-limited` | 429 | Too many requests — see [Rate limiting](#rate-limiting). |
| `internal` | 500 | Unexpected server error. Bodies never leak internal detail. |

`type` is always `https://api.metra.app/problems/{suffix}`. Branch on `status`
and the `type` suffix; treat `detail` as human-readable only.

---

## Rate limiting

Requests are limited **per API key** (currently ~**100 requests per minute**).
Over the limit returns `429 rate-limited` with a `Retry-After` header (seconds).
Back off and retry after that interval. Design integrations to page with a
reasonable `limit` and cache where possible rather than polling tightly.

---

## Resources

All list endpoints support [pagination](#pagination). All detail endpoints return
`404` for an unknown or foreign id.

### Clients

`GET /clients` · `GET /clients/{id}`

| Field | Type | Notes |
|---|---|---|
| `id` | string (uuid) | |
| `name_ar`, `name_en` | string \| null | |
| `type` | string | `individual` · `company` · `consultant` |
| `contact_name`, `email`, `phone` | string \| null | Primary contact details. |
| `city`, `address` | string \| null | |
| `tax_registration_number` | string \| null | |
| `advance_pct`, `retention_pct` | string | Default terms, two decimals (percent). |
| `notes` | string \| null | |
| `active` | boolean | |
| `created_at`, `updated_at` | string (timestamp) \| null | |

```json
{
  "id": "8f1c...",
  "name_en": "Nile Interiors",
  "name_ar": "نايل للديكور",
  "type": "company",
  "contact_name": "Sara Fouad",
  "email": "sara@nile.example",
  "phone": "+20 100 000 0000",
  "city": "Cairo",
  "address": "12 Tahrir St.",
  "tax_registration_number": "100-200-300",
  "advance_pct": "25.00",
  "retention_pct": "10.00",
  "notes": null,
  "active": true,
  "created_at": "2026-08-01T10:00:00.000000Z",
  "updated_at": "2026-08-01T10:00:00.000000Z"
}
```

### Projects

`GET /projects` · `GET /projects/{id}`

| Field | Type | Notes |
|---|---|---|
| `id` | string (uuid) | |
| `code` | string | Unique per organization. |
| `name_ar`, `name_en` | string \| null | |
| `client_id` | string (uuid) | |
| `type_id` | string (uuid) \| null | |
| `type_name_ar`, `type_name_en` | string \| null | Resolved project-type names. |
| `status` | string | Lifecycle status. |
| `description` | string \| null | |
| `advance_pct`, `retention_pct` | string | Two decimals (percent). |
| `start_date`, `end_date` | string (`YYYY-MM-DD`) \| null | |
| `city`, `address` | string \| null | |
| `notes` | string \| null | |
| `active` | boolean | |
| `created_at`, `updated_at` | string (timestamp) \| null | |

### Cost items (Price Book)

`GET /cost-items` · `GET /cost-items/{id}`

| Field | Type | Notes |
|---|---|---|
| `id` | string (uuid) | |
| `code` | string | |
| `name_ar`, `name_en` | string \| null | |
| `section_id` | string (uuid) | |
| `unit` | string | `sqm` · `linear_meter` · `pcs` · `lump_sum` · `day` |
| `default_unit_price` | string | Money, two decimals. |
| `default_unit_cost` | string | **Only if the key may see cost.** Omitted otherwise. |
| `tax_code`, `eta_item_code`, `eta_code_type` | string \| null | ETA classification codes (not PII). |
| `active` | boolean | |
| `created_at`, `updated_at` | string (timestamp) \| null | |

### Proposals

`GET /proposals` · `GET /proposals/{id}`

List returns a summary; detail adds sections and lines.

**Summary**

| Field | Type | Notes |
|---|---|---|
| `id` | string (uuid) | |
| `number` | integer | Per-org sequence (rendered `Q-YYYY-NNNN` in the app). |
| `title_ar`, `title_en` | string \| null | |
| `status` | string | `draft` · `sent` · `accepted` · `rejected` · `expired` · `superseded` |
| `currency` | string | `EGP` in v1. |
| `total` | string | Money, two decimals. |
| `issue_date` | string (`YYYY-MM-DD`) \| null | |
| `client_id`, `project_id` | string (uuid) | |
| `created_at` | string (timestamp) \| null | |

**Detail** adds `subtotal`, `discount_amount`, `taxable_base`, `tax_amount`,
`supervision_amount`, `total` (all money, two decimals), a `sections[]` array
(each with `title_ar`/`title_en`, `section_subtotal`, and a `lines[]` array), and
— **only if the key may see cost** — `total_cost` / `total_margin` at the document
level and `unit_cost` / `line_margin` per line.

Each **line**: `id`, `description_ar`/`description_en`, `cost_item_id`, `qty`,
`unit`, `unit_price`, `discount_pct`, `line_total` (money/percent as two-decimal
strings), plus `unit_cost` / `line_margin` when cost is visible.

---

## Example

```bash
BASE="https://metra-web.nabil-hakeem22.workers.dev/api/v1"
KEY="mtk_your_key_here"

# List the first 20 clients
curl -s "$BASE/clients?limit=20" -H "Authorization: Bearer $KEY"

# Fetch one project
curl -s "$BASE/projects/8f1c2b34-..." -H "Authorization: Bearer $KEY"

# A full proposal with its lines
curl -s "$BASE/proposals/3a9d...-..." -H "Authorization: Bearer $KEY"
```

---

## Scope & limits (v1)

- **Read-only.** No create/update/delete — those are planned for `v2`.
- **Resources:** clients, projects, cost-items (price book), proposals. Contracts,
  variation orders, activities, and files are not yet exposed.
- **One organization per key.** No cross-org or partner/OAuth access.
- **No webhooks** yet — poll (within the rate limit) for changes.

Questions or a field you need exposed? Tell us which resource and use case, and
we'll consider it for a future version.
