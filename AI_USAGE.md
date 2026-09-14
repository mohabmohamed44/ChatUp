# AI Usage

## Tools used

- Kilo Code

## What AI assisted with

- Monorepo scaffolding (folders, package.json, tsconfig)
- Prisma schema draft (I reviewed and adjusted field names and relations)
- Express app factory and health endpoints in `platform/http.ts`
- GCS storage adapter in `platform/storage.ts`
- Shared types in `packages/shared`
- Initial web scaffold (I made most edits to the web layer myself)

## How I verified AI output

- Ran `npx prisma migrate dev` and confirmed 8 tables exist
- Ran `npx prisma db seed` and confirmed 2 users + 1 conversation + 12 messages
- Curled `/healthz` and `/readyz` — both returned 200
- Ran `docker compose up -d` and confirmed Postgres, Redis, GCS emulator healthy
- Read every file the agent wrote before committing

## Corrections I made

- The agent initially used `@aws-sdk/client-s3` for media storage. I asked it to switch to `@google-cloud/storage` because ChatUp deploys to GCP, not AWS.
- The agent's health endpoints were originally `/health`. I standardized on `/healthz` (liveness) and `/readyz` (readiness) following Kubernetes conventions, and added a database check to `/readyz`.
- The seed script had a scrypt typing issue where `promisify` lost the options parameter. I rewrote the wrapper with an explicit Promise and typed parameters.
- The storage adapter originally talked to MinIO on port 9000. I asked the agent to swap the local emulator to `fsouza/fake-gcs-server` on port 4443 so local behavior matches production GCS.

## What I can explain in the walkthrough

- Every file in `apps/server/src/platform/` and why it exists
- The Prisma schema and how the tables relate
- The Docker Compose setup and why each service is needed
- The health check design and why liveness vs readiness matters

## What I do not claim

- I did not hand-write every line. AI was used as a productivity tool.
- I will not submit code I cannot explain. If I cannot explain it, I will either learn it or remove it.