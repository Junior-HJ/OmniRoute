import test from "node:test";
import assert from "node:assert/strict";
import { parseUpstreamError } from "../../open-sse/utils/error.ts";

test("parseUpstreamError unwraps Tencent/CodeBuddy nested Response.Error envelope", async () => {
  const body = JSON.stringify({
    Response: {
      Error: {
        Code: "11102",
        Message: "model service info not found",
      },
      RequestId: "req-123",
    },
  });
  const res = new Response(body, { status: 400, headers: { "content-type": "application/json" } });
  const parsed = await parseUpstreamError(res, "codebuddy-intl");
  assert.equal(parsed.message, "model service info not found");
  assert.equal(parsed.errorCode, "11102");
});

test("parseUpstreamError unwraps Tencent nested data.Response.Error envelope", async () => {
  const body = JSON.stringify({
    data: {
      Response: {
        Error: {
          Code: "11103",
          Message: "quota exceeded",
        },
      },
    },
  });
  const res = new Response(body, { status: 400, headers: { "content-type": "application/json" } });
  const parsed = await parseUpstreamError(res, "codebuddy-cn");
  assert.equal(parsed.message, "quota exceeded");
  assert.equal(parsed.errorCode, "11103");
});

test("parseUpstreamError unwraps Tencent top-level code + msg error", async () => {
  const body = JSON.stringify({
    code: 11101,
    msg: "Non-stream chat request is currently not supported",
  });
  const res = new Response(body, { status: 400, headers: { "content-type": "application/json" } });
  const parsed = await parseUpstreamError(res, "codebuddy-intl");
  assert.equal(parsed.message, "Non-stream chat request is currently not supported");
  assert.equal(parsed.errorCode, 11101);
});
