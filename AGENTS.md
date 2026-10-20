# Project continuity

This repository powers the live English school / translator project on Render.
Before working on the PBX integration, read `docs/technoline-integration.md`.
The user has supplied and authorized use of a Technoline account API credential.
It is stored in the Render service environment; do not ask the user to resend it
without first checking the documented integration and existing secret configuration.
Do not store credential values in repository files, browser bundles, prompts or logs.

All project changes must remain on a feature branch. The currently deployed branch
was `feature/dynamic-bots-observability` when this file was written; verify the live
service branch before deploying. Keep existing working telephone extensions and
take configuration snapshots before changing the PBX tree.

`/dashboard` is the business console; `/dashboard/legacy` is the old teacher console.
Call customer identity is independent of bot identity. Preserve that separation.
