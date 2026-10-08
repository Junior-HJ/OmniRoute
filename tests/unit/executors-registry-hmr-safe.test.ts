import test from "node:test";
import assert from "node:assert/strict";
import {
  registerLazyExecutor,
  loadRegisteredExecutor,
  hasRegisteredExecutor,
} from "../../open-sse/executors/registry.ts";
import { BaseExecutor } from "../../open-sse/executors/base.ts";

class DummyExecutor extends BaseExecutor {
  constructor(public version: number) {
    super("dummy");
  }
  async execute(): Promise<Response> {
    return new Response("ok");
  }
}

test("registerLazyExecutor is HMR-safe and re-registration overwrites cached instance", async () => {
  const alias = `test-hmr-alias-${Date.now()}`;

  // Initial lazy registration
  registerLazyExecutor(alias, async () => new DummyExecutor(1));
  assert.ok(hasRegisteredExecutor(alias), "lazy executor is registered");

  // Load and cache instance v1
  const v1 = (await loadRegisteredExecutor(alias)) as DummyExecutor;
  assert.equal(v1.version, 1);

  // Re-evaluation under HMR: re-register same alias must not throw
  assert.doesNotThrow(() => {
    registerLazyExecutor(alias, async () => new DummyExecutor(2));
  }, "re-registration under HMR should not throw duplicate alias error");

  // Loading again resolves new instance v2 (cached v1 was purged)
  const v2 = (await loadRegisteredExecutor(alias)) as DummyExecutor;
  assert.equal(v2.version, 2, "subsequent load resolves updated executor version");
});
