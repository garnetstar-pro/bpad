<!--
Branch flow: feature branch → PR to `dev` (deploys dev.bpad.pro) →
promote by merging `dev` → `master` (deploys bpad.pro).
-->

## What & why

<!-- Short description of the change and the reason for it. -->

## Type

- [ ] Feature
- [ ] Fix
- [ ] Refactor / chore
- [ ] Docs
- [ ] Promote `dev` → `master` (release to prod)

## Checklist

- [ ] `cd frontend && npm run build` passes (type-check + build)
- [ ] `cd frontend && npm run test` passes
- [ ] `cd api && python -m pytest` passes
- [ ] No user-facing strings hardcoded (English copy via `t()` / `featuresData.ts`)
- [ ] No plaintext note content sent to the server (zero-knowledge preserved)
- [ ] Verified on **dev.bpad.pro** after merge to `dev`

## Notes

<!-- Anything reviewers should know: migrations, new env vars, follow-ups. -->
