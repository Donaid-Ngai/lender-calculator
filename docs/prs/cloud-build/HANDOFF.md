# Build lender-calculator on Google Cloud

Status: ready for review

## Scope and branch

Branch `infra/cloud-build-lender-calculator` is based on `main` at
`b6625676dd7db9cc1ece23ab831993a6d5edae08`; PR
[#1](https://github.com/Donaid-Ngai/lender-calculator/pull/1). It adds only
`cloudbuild/app.yaml`; the existing Dockerfile and runtime variables stay as-is.
Live Coolify app: `mtzp348o55oapkffb6o8u890`.

## Progress

- Completed: inventoried current Dockerfile and Coolify app; added Cloud Build config.
- In progress: await review and merge.
- Remaining: after merge, switch Coolify app to Docker Image, disable Git
  auto-deploy, create main trigger and verify deployment.
- Last verification: build-only Cloud Build `f2aa371f-b5e4-4def-bbbb-73587a98c15d`
  SUCCESS on code revision `48726af`; Artifact Registry image tag `48726af`
  exists. Live deployment not run. Google Cloud repository connection exists.
- Next action: merge this review, then cut over Coolify.

## Deployment contract

Project `personal-493517`, region `europe-north1`, repository `apps`, image
`lender-calculator`. Cloud Build uses `cloudbuild-apps` and the named Secret Manager
secret `coolify-api-token`; no secret value is stored in source. The trigger watches
all source files on `main`. Coolify keeps existing domains and runtime variables.
Rollback sets the previous image SHA and redeploys, or restores Dockerfile build
pack and Git auto-deploy.
