import type { CodeBuddyOperationContext } from "./context.ts";
import { CodeBuddyTelemetrySession } from "./telemetry.ts";
import {
  buildSpanTree,
  sendReportBatch,
  sendTraceSpans,
  CODEBUDDY_DEFAULT_BASE_URL,
} from "./telemetryTransport.ts";

/**
 * Wire one executed turn to the captured telemetry endpoints.
 *
 * Contract:
 *  - SYNTHETIC but REAL: the events/spans are built from this execution's ids,
 *    timings and usage, then actually POSTed to `/v2/report` and `/v1/traces`.
 *  - Side channel: never throws, never blocks the caller (fire-and-forget) and
 *    never logs payloads.
 *  - Opt-out: disabled by `OMNIROUTE_CODEBUDDY_TELEMETRY=0`, so an operator can
 *    stop the outbound reports without touching code.
 */

export const CODEBUDDY_TELEMETRY_ENV = "OMNIROUTE_CODEBUDDY_TELEMETRY";
const TELEMETRY_TIMEOUT_MS = 5_000;

export interface ReportTurnInput {
  op: CodeBuddyOperationContext;
  model: string;
  startedAtMs: number;
  endedAtMs: number;
  firstTokenAtMs?: number;
  credentials?: { accessToken?: string | null; providerSpecificData?: unknown } | null;
  status: "success" | "error" | "cancelled";
  message?: string;
  usage?: unknown;
  fetchImpl?: typeof fetch;
}

/**
 * Telemetry is ON by default; `OMNIROUTE_CODEBUDDY_TELEMETRY=0|false|off` disables it.
 *
 * The default argument reads the variable in its literal `process.env` member
 * form on purpose: `check:env-doc-sync` only recognises that spelling, so the
 * dynamic `env[CODEBUDDY_TELEMETRY_ENV]` read that keeps this function
 * injectable would leave the switch outside the documented env contract.
 * Reading it in the default keeps it evaluated per call.
 */
export function isCodeBuddyTelemetryEnabled(
  env: NodeJS.ProcessEnv = { [CODEBUDDY_TELEMETRY_ENV]: process.env.OMNIROUTE_CODEBUDDY_TELEMETRY }
): boolean {
  const raw = (env[CODEBUDDY_TELEMETRY_ENV] || "").trim().toLowerCase();
  return !(raw === "0" || raw === "false" || raw === "off" || raw === "no");
}

function readMachineId(credentials: ReportTurnInput["credentials"]): string {
  const data = credentials?.providerSpecificData;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    for (const key of ["machineId", "machine_id", "deviceId", "device_id"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  // Stable per install without inventing an account identifier.
  return `omniroute-${process.platform}-${process.arch}`;
}

function readAccountId(credentials: ReportTurnInput["credentials"]): string | undefined {
  const data = credentials?.providerSpecificData;
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  for (const key of ["userId", "user_id", "accountId", "account_id", "sub"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Build, send and forget. Returns a promise only so tests can await it; the
 * executor calls it without awaiting.
 */
export async function reportTurn(input: ReportTurnInput): Promise<void> {
  if (!isCodeBuddyTelemetryEnabled()) return;

  try {
    const session = new CodeBuddyTelemetrySession({
      root: input.op.root,
      machineId: readMachineId(input.credentials),
      accountId: readAccountId(input.credentials),
    });

    session.requestSend(input.op, { model: input.model });
    session.messageSend(input.op, { model: input.model });
    if (input.firstTokenAtMs !== undefined) session.firstToken(input.op);

    if (input.status === "success") {
      session.messageResponse(input.op, { model: input.model, usage: input.usage });
      session.messageStatus(input.op, { status: "success" });
      session.requestResponse(input.op, { status: "success" });
    } else {
      session.fail(input.op, { status: input.status, message: input.message });
    }

    const accessToken = input.credentials?.accessToken ?? null;
    const fetchImpl = input.fetchImpl ?? fetch;

    // Both endpoints are independent: one failing must not cancel the other.
    await Promise.allSettled([
      sendReportBatch(session.buildBatch(), {
        baseUrl: CODEBUDDY_DEFAULT_BASE_URL,
        accessToken,
        fetchImpl,
        timeoutMs: TELEMETRY_TIMEOUT_MS,
      }),
      sendTraceSpans(
        buildSpanTree(input.op, {
          model: input.model,
          startedAtMs: input.startedAtMs,
          endedAtMs: input.endedAtMs,
          firstTokenAtMs: input.firstTokenAtMs,
          usage: input.usage as Record<string, unknown> | undefined,
          status: input.status,
        }),
        { baseUrl: CODEBUDDY_DEFAULT_BASE_URL, fetchImpl, timeoutMs: TELEMETRY_TIMEOUT_MS }
      ),
    ]);
  } catch {
    // Telemetry must never surface as a request failure. Nothing to log: the
    // payloads carry account data and the outcome does not affect routing.
  }
}
