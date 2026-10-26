// A dated 429 must freeze the account until the provider's OWN date.
//
// Live capture (2026-10-26, real Free-plan account) — the gateway states its
// unlock instant in PROSE, not in a structured field:
//
//   [429]: usage exceeds frequency limit, but don't worry, your usage will
//          reset at 2026-10-26 10:17:44
//
// Three separate obstacles used to swallow that date, each covered below:
//   1. the shared text parser did not reach the 429 path at all, because the
//      OAuth connection-cooldown profile sets `useUpstreamRetryHints: false`
//      for EVERY OAuth provider — the resolved cooldown was 5000 ms;
//   2. even when parsed, `maxCooldownMs` (30 min by default) truncated the
//      ~9 h reset, because a prose hint never bypasses the operator cap;
//   3. the executor's synthesized message said "frozen until", a phrase the
//      shared parser does not know (it knows "wait until" / "reset at").
//
// The fix is `RegistryEntry.trustUpstreamResetDate`: a per-provider opt-in, so
// one provider can trust its own date without flipping the category-wide policy
// for the other OAuth providers.
import test from "node:test";
import assert from "node:assert/strict";

import {
  checkFallbackError,
  getProviderProfile,
  parseRetryFromErrorText,
  recordModelLockoutFailure,
  upstreamResetDateIsAuthoritative,
} from "../../open-sse/services/accountFallback.ts";
import { getRegistryEntry } from "../../open-sse/config/providerRegistry.ts";

// Verbatim from the live capture. No timezone is given; the shared parser reads
// a naive datetime as UTC (resolveNaiveResetZone → "Z"), which is what the
// gateway means.
const CAPTURED_429_MESSAGE =
  "usage exceeds frequency limit, but don't worry, your usage will reset at 2026-10-26 10:17:44";

const STATED_RESET_MS = Date.UTC(2026, 9, 26, 10, 17, 44);

test("the captured prose message parses to the provider's stated reset instant", () => {
  const hint = parseRetryFromErrorText(CAPTURED_429_MESSAGE, "codebuddy-intl");
  assert.ok(hint !== null, "the prose date must be readable");
  // The parser returns a WAIT, so compare against now + wait.
  const impliedReset = Date.now() + hint;
  assert.ok(
    Math.abs(impliedReset - STATED_RESET_MS) < 5_000,
    `expected ~${new Date(STATED_RESET_MS).toISOString()}, got ${new Date(impliedReset).toISOString()}`
  );
});

test("codebuddy-intl opts in to trusting its own reset date", () => {
  assert.equal(getRegistryEntry("codebuddy-intl")?.trustUpstreamResetDate, true);
});

test("the opt-in is not global: other OAuth providers keep their policy", () => {
  // codebuddy-cn shares the gateway family but has no verified 429 capture.
  assert.notEqual(getRegistryEntry("codebuddy-cn")?.trustUpstreamResetDate, true);
  assert.equal(getProviderProfile("codebuddy-cn").useUpstreamRetryHints, false);
});

test("a dated 429 freezes codebuddy-intl until the stated date, not 5 seconds", () => {
  const profile = getProviderProfile("codebuddy-intl");
  const result = checkFallbackError(
    429,
    CAPTURED_429_MESSAGE,
    0,
    "default-model",
    "codebuddy-intl",
    null,
    profile
  );

  assert.equal(result.shouldFallback, true);
  assert.equal(result.usedUpstreamRetryHint, true);
  assert.equal(result.retryHintSource, "body");

  const freezeEndsAt = Date.now() + result.cooldownMs;
  assert.ok(
    Math.abs(freezeEndsAt - STATED_RESET_MS) < 5_000,
    `freeze should end at the provider's date, got ${new Date(freezeEndsAt).toISOString()}`
  );
  // Guard the original regression explicitly: 5 s was the old behaviour.
  assert.ok(result.cooldownMs > 60 * 60 * 1000, "a ~9h reset must not collapse to seconds");
});

test("the same body on an opted-out provider keeps the short transient cooldown", () => {
  const profile = getProviderProfile("codebuddy-cn");
  const result = checkFallbackError(
    429,
    CAPTURED_429_MESSAGE,
    0,
    "default-model",
    "codebuddy-cn",
    null,
    profile
  );
  assert.equal(result.usedUpstreamRetryHint, false);
  assert.ok(result.cooldownMs < 60_000, `expected a short cooldown, got ${result.cooldownMs}`);
});

test("a prose date is authoritative only for a provider that opted in", () => {
  assert.equal(upstreamResetDateIsAuthoritative("body", "codebuddy-intl"), true);
  assert.equal(upstreamResetDateIsAuthoritative("body", "openai"), false);
  assert.equal(upstreamResetDateIsAuthoritative("body", null), false);
});

test("header and google.rpc hints stay authoritative for every provider", () => {
  for (const provider of ["openai", "codebuddy-intl", null]) {
    assert.equal(upstreamResetDateIsAuthoritative("header", provider), true);
    assert.equal(upstreamResetDateIsAuthoritative("google_rpc_retry_info", provider), true);
  }
});

test("the model-lockout path honors the opted-in date instead of the 30 min cap", () => {
  const profile = getProviderProfile("codebuddy-intl");
  const nineHours = 9.3 * 60 * 60 * 1000;
  const lock = (bypass: boolean) =>
    recordModelLockoutFailure(
      "codebuddy-intl",
      "conn-freeze-test",
      "default-model",
      "rate_limited",
      429,
      profile.baseCooldownMs,
      profile,
      {
        exactCooldownMs: nineHours,
        maxCooldownMs: profile.maxCooldownMs,
        scope: "exact",
        exactCooldownIsUpstreamReset: bypass,
      }
    ).cooldownMs;

  // Opted in: the provider's date wins.
  assert.equal(lock(true), nineHours);
  // Capped: the operator ceiling still applies when the hint is not trusted.
  assert.equal(lock(false), profile.maxCooldownMs);
});

test("the executor's synthesized 429 message is itself parseable", async () => {
  const { CodeBuddyIntlExecutor } = await import("../../open-sse/executors/codebuddy-intl.ts");
  const executor = new CodeBuddyIntlExecutor();

  const resetIso = "2026-10-26T10:17:44.000Z";
  const bodyText = JSON.stringify({
    code: 11129,
    msg: "usage exceeds frequency limit",
    data: { resetTime: resetIso },
  });
  const response = new Response(bodyText, {
    status: 429,
    headers: { "Content-Type": "application/json" },
  });

  const parsed = executor.parseError(response, bodyText);
  assert.equal(parsed.status, 429);
  assert.equal(parsed.resetsAtMs, Date.parse(resetIso));

  // The message must round-trip through the shared text parser: "frozen until"
  // was invisible to it, so the date would be lost on the way back.
  const roundTrip = parseRetryFromErrorText(parsed.message, "codebuddy-intl");
  assert.ok(roundTrip !== null, `message not parseable: ${parsed.message}`);
  assert.ok(Math.abs(Date.now() + roundTrip - Date.parse(resetIso)) < 5_000);
});
