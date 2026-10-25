// The route-facing catalog boundary.
//
// `src/app/**` cannot import `open-sse/executors/**` (eslint
// `no-restricted-imports`), so the `/api/providers/[id]/models` route talks to
// this service hop instead. What matters here is the contract the route relies
// on: the native catalog shape is translated once, and a failed fetch degrades
// to `ok: false` with an empty list rather than throwing (the route then keeps
// its curated fallback instead of emptying the model picker).
import test from "node:test";
import assert from "node:assert/strict";

import {
  clearCodeBuddyIntlModelCache,
  discoverCodeBuddyIntlModels,
} from "../../open-sse/services/codebuddyIntlCatalog.ts";

const CONFIG_PAYLOAD = {
  code: 0,
  data: {
    models: [
      {
        id: "glm-5.2",
        name: "GLM-5.2",
        max_input_tokens: 200000,
        max_output_tokens: 32000,
        supports_vision: true,
        supports_reasoning: true,
      },
    ],
  },
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test.beforeEach(() => clearCodeBuddyIntlModelCache());

test("translates the native catalog into the route model shape", async () => {
  const result = await discoverCodeBuddyIntlModels({
    accessToken: "token",
    fetchImpl: (async () => jsonResponse(CONFIG_PAYLOAD)) as unknown as typeof fetch,
  });

  assert.equal(result.ok, true);
  assert.equal(result.cached, false);
  assert.equal(result.models.length, 1);
  assert.deepEqual(result.models[0], {
    id: "glm-5.2",
    name: "GLM-5.2",
    contextLength: 200000,
    maxOutputTokens: 32000,
    supportsVision: true,
    supportsReasoning: true,
  });
});

test("omits capabilities the catalog did not declare", async () => {
  const result = await discoverCodeBuddyIntlModels({
    accessToken: "token",
    fetchImpl: (async () =>
      jsonResponse({
        code: 0,
        data: { models: [{ id: "plain-model", name: "Plain" }] },
      })) as unknown as typeof fetch,
  });

  assert.equal(result.ok, true);
  // No invented numbers: absent fields stay absent instead of becoming 0.
  assert.deepEqual(result.models[0], { id: "plain-model", name: "Plain" });
});

test("a failing catalog degrades to an empty list instead of throwing", async () => {
  const result = await discoverCodeBuddyIntlModels({
    accessToken: "token",
    fetchImpl: (async () => jsonResponse({ error: "nope" }, 500)) as unknown as typeof fetch,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.models, []);
  assert.equal(result.status, 500);
});

test("a transport error is reported, never propagated", async () => {
  const result = await discoverCodeBuddyIntlModels({
    accessToken: "token",
    fetchImpl: (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch,
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.models, []);
  assert.match(String(result.error), /socket hang up/);
});

test("a second call inside the TTL is served from cache", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse(CONFIG_PAYLOAD);
  }) as unknown as typeof fetch;

  const now = Date.now();
  const first = await discoverCodeBuddyIntlModels({ accessToken: "t", fetchImpl, now });
  const second = await discoverCodeBuddyIntlModels({
    accessToken: "t",
    fetchImpl,
    now: now + 1000,
  });

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(calls, 1);
});

test("the access token is sent as a bearer credential", async () => {
  let seen: Record<string, string> = {};
  await discoverCodeBuddyIntlModels({
    accessToken: "secret-token",
    fetchImpl: (async (_url: string, init: RequestInit) => {
      seen = init.headers as Record<string, string>;
      return jsonResponse(CONFIG_PAYLOAD);
    }) as unknown as typeof fetch,
  });

  assert.equal(seen.Authorization, "Bearer secret-token");
  // The catalog request carries the CLI identity, not a browser one.
  assert.equal(seen["X-IDE-Type"], "CLI");
});
