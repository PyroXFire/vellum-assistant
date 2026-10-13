/**
 * Codename-Localhost fork switches.
 *
 * This repository is a fork of `vellum-ai/vellum-assistant` that runs as a
 * self-hosted, local-model-only deployment. Upstream ships two outbound
 * reporting channels that a self-hosted install has no business using, and
 * both are switched off here rather than left to build-time environment
 * variables — a fork that silently resumes reporting when someone rebuilds
 * without the "right" `VITE_*` set is worse than one that cannot report at all.
 *
 * Typed as `boolean` rather than a literal `false` on purpose. A literal would
 * let the compiler constant-fold the guard and mark the code behind it
 * unreachable, which turns a deliberate off-switch into a type error under
 * `allowUnreachableCode: false`.
 *
 * Consumers:
 * - `lib/sentry/sentry-init.ts` — crash and diagnostics reporting to Sentry.
 * - `lib/telemetry/ingest.ts`   — product/funnel analytics to the platform.
 *
 * Setting either to `true` restores upstream behavior for that channel. Do not
 * flip these without also restoring a DSN; see the README's "Telemetry" note.
 */
export const CL_TELEMETRY_ENABLED: boolean = false;
