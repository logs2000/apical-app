# apical-scheduler (proprietary)

Cloud scheduler that polls the hosted database for due ScheduledJobs and
fires workflow runs. The desktop app uses the in-process local scheduler
(src/lib/platform/local-scheduler.ts) instead, which IS part of the ELv2
core. This service is part of the Apical **cloud plane** — NOT covered by
the Elastic License 2.0. All rights reserved.

See ../../../LICENSING.md for the license map.
