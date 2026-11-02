# Research Lab

A private research publishing application: projects, email-based membership, report-level access, comments, and an agent publishing API. Source code can be public; the database, uploads, API credentials and sessions must remain private.

## Architecture

| Layer | Implementation |
|---|---|
| Frontend | React 19 SPA, esbuild, responsive project/report views |
| Backend | Node.js 24 HTTP handler, deployed as a Vercel Function |
| Database | PostgreSQL via `pg`; versioned initial schema in `migrations/001_initial.sql` |
| Reports | Private Vercel Blob, accessed through authorized application routes |
| Authentication | Email OTP through Resend, admin password, or single-use member links |
| Automation | Bearer tokens, `/api/v1`, CLI publisher |

## Vercel setup

The source is ready to deploy. A deployment without `DATABASE_URL` intentionally displays a setup notice and cannot accept sign-ins. It does not fall back to an ephemeral production database.

1. Import this repository into Vercel. Build: `npm run build`; output: `web/dist`; Node: 24.x. `vercel.json` configures API and SPA routes.
2. In the project's Storage tab, connect a PostgreSQL integration such as Neon. Set the pooled connection string as **DATABASE_URL** in the project's production environment. If the integration only creates `POSTGRES_URL`, copy that connection value into `DATABASE_URL` through Vercel's environment settings. Do not commit it.
3. Connect a **private** Vercel Blob store. This creates `BLOB_READ_WRITE_TOKEN` automatically.
4. Set `ADMIN_EMAIL` to the owner email and set a strong, unique `ADMIN_PASSWORD` in Vercel's encrypted environment settings. No default password is provided. The owner can then issue single-use member sign-in links.
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
