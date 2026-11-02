# Research Lab

A private research publishing application: projects, email-based membership, report-level access, comments, and an agent publishing API. Source code can be public; the database, uploads, API credentials and sessions must remain private.

## Architecture

| Layer | Implementation |
|---|---|
| Frontend | React 19 SPA, esbuild, responsive project/report views |
| Backend | Node.js 24 HTTP handler, deployed as a Vercel Function |
| Database | PostgreSQL via `pg`; versioned initial schema in `migrations/001_initial.sql` |
| Reports | Private Vercel Blob, accessed through authorized application routes |
| Authentication | Clerk when configured; legacy email OTP/password/links otherwise |
| Automation | Bearer tokens, `/api/v1`, CLI publisher |

## Vercel setup

The source is ready to deploy. A deployment without `DATABASE_URL` intentionally displays a setup notice and cannot accept sign-ins. It does not fall back to an ephemeral production database.

1. Import this repository into Vercel. Build: `npm run build`; output: `web/dist`; Node: 24.x. `vercel.json` configures API and SPA routes.
2. In the project's Storage tab, connect a PostgreSQL integration such as Neon. Set the pooled connection string as **DATABASE_URL** in the project's production environment. If the integration only creates `POSTGRES_URL`, copy that connection value into `DATABASE_URL` through Vercel's environment settings. Do not commit it.
3. Connect a **private** Vercel Blob store. This creates `BLOB_READ_WRITE_TOKEN` automatically.
4. Set `ADMIN_EMAIL` to the owner’s verified email and configure Clerk using the section below. For legacy authentication only, set a strong, unique `ADMIN_PASSWORD`; the owner can then issue single-use member sign-in links.
5. Optionally configure `RESEND_API_KEY` and `MAIL_FROM` using a verified sending domain to enable emailed codes and invitations. Without these, the production app does not log sign-in codes or claim an email was sent.
6. Redeploy after environment changes. `/healthz` returns 200 only when database initialization succeeds. Tables are created idempotently on the first database request under a PostgreSQL advisory lock. `npm run db:migrate` runs the same initialization explicitly.
7. Use separate databases and Blob stores for preview and production before permitting untrusted preview builds. Provision backups through the PostgreSQL provider.

The configured public hostname is the Vercel-assigned project domain; uploaded reports still require application authentication. No custom domain purchase is necessary.

## Local development

```sh
npm ci
cp .env.example .env
# Fill DATABASE_URL, ADMIN_EMAIL and ADMIN_PASSWORD in .env
node --env-file=.env server.js
```

Run `npm run build` after UI changes. Without a Blob token, local development stores files under `data/files`. Local PostgreSQL is still required. Production on Vercel always requires private Blob. `npm test` uses isolated in-memory PGlite (real PostgreSQL compiled to WASM) and temporary files, with no cloud credentials.

```sh
npm test
npm run build
```

Tests exercise HTTP authentication, migrations, membership, report permissions and raw-file protection, OTP attempt limits, single-use links, comments, token API publication, CSRF, and access revocation. Cloud upload behavior additionally needs a configured deployment for end-to-end verification.

## Access rules

- Admins can manage all projects and reports. Members only see projects explicitly shared with their email address.
- Restricted reports require both project membership and an entry in their access list.
- Invalid nonempty restriction lists are rejected, rather than silently making reports available to everyone. An explicitly restricted empty access list remains admin-only when editing access.
- Removing a member revokes report and raw-file access immediately. File responses use `private, no-store`.
- API tokens are admin-level publishing credentials; keep them server-side. Sessions, OTPs, links, and API tokens are stored as hashes.
- Writes require the custom request header and same-origin validation. HTML and SVG reports use an opaque-origin CSP sandbox. Interactive uploaded HTML can contact external services; do not upload untrusted active content expecting offline isolation.

## Publishing API

Use `Authorization: Bearer rh_...`, generated from the administrator's **Push from LLM** page.

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/api/v1/projects` | List/create projects |
| GET | `/api/v1/projects/:slug/reports` | List reports |
| POST | `/api/v1/reports` | Publish JSON content, small multipart files, or finalize `uploadId` |
| GET | `/api/v1/reports/:id/comments` | Read comments |
| POST | `/api/v1/projects/:slug/uploads` | Initialize a private direct-upload session |
| POST | `/api/v1/blob/upload` | SDK client-token exchange for that upload |

Example JSON payload:

```json
{"project":"battery-research","title":"Cell outlook","format":"markdown","content":"# Findings\n...","allowed":["member@example.com"]}
```

Vercel request payloads are bounded. Keep JSON/paste and multipart API requests below **4 MB**. The browser uploads files **directly to private Blob, up to 100 MB**, bypassing that request limit. Use the supplied Node publisher for larger agent files:

```sh
export RH_URL=https://your-project.vercel.app
# Set RH_TOKEN securely in your shell or secret manager.
node scripts/publish.mjs battery-research report.pdf "Cell outlook" "Q4 research"
```

`RH_ALLOWED=a@example.com,b@example.com` restricts the report to those project members. The original `push.sh` remains available for small uploads and pasted stdin. It is not a workaround for the Vercel request-size limit.

## Operational limits

- PostgreSQL provider setup and an admin authentication secret are required to activate a fresh deployment.
- Mutations are serialized using a database advisory lock to protect one-time tokens, OTP attempts and slug allocation. This suits a small research team; higher write throughput should use narrower locks/atomic operations.
- Metadata changes are transactional; Blob writes/deletes are external operations. Failed operations can leave orphaned files. Add a scheduled reconciliation/retention job before operating at large scale.
- Abandoned direct-upload sessions expire after one hour; expired metadata and orphaned uploaded objects currently need administrative cleanup.
- Byte-range reads are supported; private Blob ranges currently read from origin and slice the stream, which can cost more bandwidth for large videos.
- Reports are published as new items; content version history and inline Office document rendering are not implemented.
- No claims of cloud end-to-end validation should be made until PostgreSQL and sign-in are configured.

## Clerk login

Set these environment variables in Vercel (and your local `.env`):

- `CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`: matching keys from the same Clerk application.
- `CLERK_AUTHORIZED_PARTIES`: comma-separated exact application origins, e.g. `https://your-fork.vercel.app,http://localhost:3000`. Include each preview origin you actually use. Defaults to `BASE_URL` when omitted.
- `ADMIN_EMAIL`: the verified primary email address of each administrator, comma-separated.

The React app fetches the publishable key from `/api/app/auth-config` at runtime; no secret is included in its bundle. Configure sign-in methods in the Clerk dashboard. To offer GitHub login, enable the GitHub social connection in Clerk; production OAuth credentials and redirect URLs must be configured there. A GitHub repository username alone does not grant Research Lab admin access.

When either Clerk key is set, configuration must be complete or authentication fails closed. Once both keys and origins are set, Clerk replaces browser authentication: old session cookies, password/OTP endpoints, and existing magic links no longer authenticate users. New member links point to `/login`. Removing both keys restores the legacy mode for rollback. Existing project memberships and report permissions remain associated with email addresses; users must use their verified primary Clerk email matching those records. No password or user migration is needed because the old system has no per-user password database. Agent publishing tokens remain independent.

Redeploy after setting runtime variables. The database and private Blob requirements above still apply. For local development, use `node --env-file=.env server.js` after `npm run build`. Never commit keys. Validate a real Clerk sign-in and sign-out, a member's private report, and direct Blob upload on your configured deployment before rollout. The automated suite covers the adapter's verified-email mapping, legacy-login cutover, missing configuration, unauthenticated/invalid tokens, and the existing permissions/API lifecycle; it does not replace a live Clerk OAuth test.

Integration references: [React quickstart](https://clerk.com/docs/react/getting-started/quickstart) and [backend request authentication](https://clerk.com/docs/reference/backend/authenticate-request).
