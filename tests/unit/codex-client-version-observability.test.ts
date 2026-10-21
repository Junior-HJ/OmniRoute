import assert from "node:assert/strict";
import test from "node:test";
import * as codexClient from "../../open-sse/config/codexClient.ts";

const originalVersion = process.env.CODEX_CLIENT_VERSION;
const registryResponse = (version = "0.160.1") => Response.json({ name: "@openai/codex", version });

test.beforeEach(() => {
  delete process.env.CODEX_CLIENT_VERSION;
});

test.afterEach(() => {
  codexClient.resetCodexClientVersionCacheForTests?.();
  test.mock.restoreAll();
  if (originalVersion === undefined) delete process.env.CODEX_CLIENT_VERSION;
  else process.env.CODEX_CLIENT_VERSION = originalVersion;
});

/**
 * #16714: a refresh failure used to be swallowed by a bare `catch {}`, so a
 * deployment with a blocked registry (proxy / corporate egress) silently kept
 * the pinned version and no operator could tell why the live catalog was short.
 */
test("a failed refresh is reported through the logger instead of being swallowed", async () => {
  const warnings: string[] = [];
  test.mock.method(console, "warn", (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });

  const version = await codexClient.refreshCodexClientVersion(async () => {
    throw new Error("registry blocked");
  });

  assert.equal(version, codexClient.DEFAULT_CODEX_CLIENT_VERSION);
  assert.equal(warnings.length, 1, "a failed refresh must emit exactly one warning");
  assert.match(warnings[0], /codex/i);
  assert.match(warnings[0], /registry blocked/);
  assert.match(
    warnings[0],
    new RegExp(codexClient.DEFAULT_CODEX_CLIENT_VERSION.replace(/\./g, "\\."))
  );
});

test("a successful refresh does not warn", async () => {
  const warnings: string[] = [];
  test.mock.method(console, "warn", (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });

  assert.equal(
    await codexClient.refreshCodexClientVersion(async () => registryResponse()),
    "0.160.1"
  );
  assert.deepEqual(warnings, []);
});

test("the refresh outcome is observable so discovery can report a degraded catalog", async () => {
  const failed = await codexClient.refreshCodexClientVersion(async () => {
    throw new Error("offline");
  });
  assert.equal(failed, codexClient.DEFAULT_CODEX_CLIENT_VERSION);
  assert.equal(codexClient.getCodexClientVersionSource(), "fallback");

  codexClient.resetCodexClientVersionCacheForTests();

  assert.equal(
    await codexClient.refreshCodexClientVersion(async () => registryResponse()),
    "0.160.1"
  );
  assert.equal(codexClient.getCodexClientVersionSource(), "registry");
});

test("an env override reports the override source without touching the network", async () => {
  process.env.CODEX_CLIENT_VERSION = "0.149.0";
  await codexClient.refreshCodexClientVersion(async () => {
    assert.fail("an explicit version must not fetch metadata");
  });
  assert.equal(codexClient.getCodexClientVersionSource(), "override");
});

test("a non-ok response is reported too, not only a thrown error", async () => {
  const warnings: string[] = [];
  test.mock.method(console, "warn", (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });

  assert.equal(
    await codexClient.refreshCodexClientVersion(async () => new Response(null, { status: 503 })),
    codexClient.DEFAULT_CODEX_CLIENT_VERSION
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /503/);

  codexClient.resetCodexClientVersionCacheForTests();

  assert.equal(
    await codexClient.refreshCodexClientVersion(async () => new Response("bad json")),
    codexClient.DEFAULT_CODEX_CLIENT_VERSION
  );
  assert.equal(warnings.length, 2);
});
