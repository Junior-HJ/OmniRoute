// Phase D — turn reporting orchestration.
//
// The executor calls this WITHOUT awaiting, so the properties that matter are:
// it never throws, it never blocks, it sends to both endpoints, and it can be
// switched off by the operator without a code change.
import test from "node:test";
import assert from "node:assert/strict";

import {
  createOperationContext,
  createRootContext,
} from "../../open-sse/executors/codebuddy-intl/context.ts";
import {
  reportTurn,
  isCodeBuddyTelemetryEnabled,
  CODEBUDDY_TELEMETRY_ENV,
} from "../../open-sse/executors/codebuddy-intl/reportTurn.ts";
import {
  CODEBUDDY_REPORT_PATH,
  CODEBUDDY_TRACES_PATH,
} from "../../open-sse/executors/codebuddy-intl/telemetryTransport.ts";

const op = () => createOperationContext(createRootContext(), "conversation");

function recordingFetch(calls: Array<{ url: string; body: unknown }>, status = 200) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response("{}", { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

test("a successful turn reports to both /v2/report and /v1/traces", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const operation = op();

  await reportTurn({
    op: operation,
    model: "kimi-k3.1-pro",
    startedAtMs: Date.now() - 1_000,
    endedAtMs: Date.now(),
    firstTokenAtMs: Date.now() - 500,
    credentials: { accessToken: "tok" },
    status: "success",
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    fetchImpl: recordingFetch(calls),
  });

  const urls = calls.map((call) => call.url);
  assert.equal(
    urls.some((url) => url.endsWith(CODEBUDDY_REPORT_PATH)),
    true
  );
  assert.equal(
    urls.some((url) => url.endsWith(CODEBUDDY_TRACES_PATH)),
    true
  );
});

test("report events carry the same ids as the chat request", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const operation = op();

  await reportTurn({
    op: operation,
    model: "m",
    startedAtMs: Date.now() - 100,
    endedAtMs: Date.now(),
    credentials: { accessToken: "tok" },
    status: "success",
    fetchImpl: recordingFetch(calls),
  });

  const report = calls.find((call) => call.url.endsWith(CODEBUDDY_REPORT_PATH));
  const events = (report?.body as { events: Array<Record<string, unknown>> }).events;

  assert.ok(events.length > 0);
  for (const event of events) {
    assert.equal(event.conversationRequestId, operation.conversationRequestId);
    assert.equal(event.traceId, operation.traceId);
    assert.equal(event.sessionId, operation.root.conversationId);
  }
});

test("a failed turn still closes its events", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];

  await reportTurn({
    op: op(),
    model: "m",
    startedAtMs: Date.now() - 100,
    endedAtMs: Date.now(),
    credentials: { accessToken: "tok" },
    status: "error",
    message: "upstream exploded",
    fetchImpl: recordingFetch(calls),
  });

  const report = calls.find((call) => call.url.endsWith(CODEBUDDY_REPORT_PATH));
  const events = (report?.body as { events: Array<{ event: string; status?: string }> }).events;
  const names = events.map((event) => event.event);

  assert.equal(names.includes("chat_message_status"), true);
  assert.equal(names.at(-1), "chat_request_response");
});

test("a telemetry outage never throws", async () => {
  const failing = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;

  await assert.doesNotReject(() =>
    reportTurn({
      op: op(),
      model: "m",
      startedAtMs: Date.now() - 100,
      endedAtMs: Date.now(),
      credentials: { accessToken: "tok" },
      status: "success",
      fetchImpl: failing,
    })
  );
});

test("an HTTP error response never throws", async () => {
  await assert.doesNotReject(() =>
    reportTurn({
      op: op(),
      model: "m",
      startedAtMs: Date.now() - 100,
      endedAtMs: Date.now(),
      credentials: { accessToken: "tok" },
      status: "success",
      fetchImpl: recordingFetch([], 500),
    })
  );
});

test("telemetry is enabled by default and disabled by the operator switch", () => {
  assert.equal(isCodeBuddyTelemetryEnabled({}), true);
  assert.equal(isCodeBuddyTelemetryEnabled({ [CODEBUDDY_TELEMETRY_ENV]: "1" }), true);
  assert.equal(isCodeBuddyTelemetryEnabled({ [CODEBUDDY_TELEMETRY_ENV]: "0" }), false);
  assert.equal(isCodeBuddyTelemetryEnabled({ [CODEBUDDY_TELEMETRY_ENV]: "false" }), false);
  assert.equal(isCodeBuddyTelemetryEnabled({ [CODEBUDDY_TELEMETRY_ENV]: "OFF" }), false);
});

test("the machine id comes from the account, never from an invented identity", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];

  await reportTurn({
    op: op(),
    model: "m",
    startedAtMs: Date.now() - 100,
    endedAtMs: Date.now(),
    credentials: {
      accessToken: "tok",
      providerSpecificData: { machineId: "machine-abc", userId: "user-xyz" },
    },
    status: "success",
    fetchImpl: recordingFetch(calls),
  });

  const report = calls.find((call) => call.url.endsWith(CODEBUDDY_REPORT_PATH));
  const body = report?.body as { machineId: string; accountId?: string };
  assert.equal(body.machineId, "machine-abc");
  assert.equal(body.accountId, "user-xyz");
});
