import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKBUDDY_DEFAULT_HEADERS,
  WORKBUDDY_USER_AGENT,
  withWorkbuddyHeaders,
  fitTools,
  fitSchema,
  fitShape,
  sanitizeToolChoice,
  sanitizeWorkbuddyBody,
  turnKey,
  conversationKey,
} from "../../open-sse/utils/workbuddyGateway.ts";

test("workbuddy default headers enforce client identity and craft purpose", () => {
  assert.equal(WORKBUDDY_DEFAULT_HEADERS["User-Agent"], WORKBUDDY_USER_AGENT);
  assert.equal(WORKBUDDY_DEFAULT_HEADERS["X-Product"], "SaaS");
  assert.equal(WORKBUDDY_DEFAULT_HEADERS["X-IDE-Type"], "WorkBuddy");
  assert.equal(WORKBUDDY_DEFAULT_HEADERS["X-IDE-Name"], "WorkBuddy");
  assert.equal(WORKBUDDY_DEFAULT_HEADERS["X-Requested-With"], "XMLHttpRequest");
  assert.equal(WORKBUDDY_DEFAULT_HEADERS["X-Agent-Intent"], "craft");
  assert.equal(WORKBUDDY_DEFAULT_HEADERS["X-Agent-Purpose"], "conversation");
  assert.equal(WORKBUDDY_DEFAULT_HEADERS["X-Agent-Type"], "main");
});

test("withWorkbuddyHeaders derives stable turn and conversation keys", async (t) => {
  const body = {
    messages: [
      { role: "user", content: "hello world" },
      { role: "assistant", content: "hi" },
      { role: "user", content: "list files" },
    ],
  };

  await t.test("attaches conversation, turn and message tracking headers", () => {
    const headers = withWorkbuddyHeaders({}, body);
    assert.ok(headers["X-Conversation-ID"]);
    assert.ok(headers["X-Conversation-Request-ID"]);
    assert.ok(headers["X-Conversation-Message-ID"]);
    assert.equal(headers["X-Request-ID"], headers["X-Conversation-Message-ID"]);
  });

  await t.test("keeps conversation id and turn id stable for repeated turn calls", () => {
    const h1 = withWorkbuddyHeaders({}, body);
    const h2 = withWorkbuddyHeaders({}, body);
    assert.equal(h1["X-Conversation-ID"], h2["X-Conversation-ID"]);
    assert.equal(h1["X-Conversation-Request-ID"], h2["X-Conversation-Request-ID"]);
    assert.notEqual(h1["X-Conversation-Message-ID"], h2["X-Conversation-Message-ID"]);
  });

  await t.test("honors explicit session key over message signature", () => {
    const h1 = withWorkbuddyHeaders({}, body, "sess_1");
    const h2 = withWorkbuddyHeaders({}, body, "sess_2");
    assert.notEqual(h1["X-Conversation-ID"], h2["X-Conversation-ID"]);
  });
});

test("fitTools sanitizes tool names and parameter schemas", () => {
  const body = {
    tools: [
      {
        type: "function",
        function: {
          name: "mcp:read.file",
          parameters: {
            type: "object",
            pattern: "test\\0end",
            items: [{ type: "string" }, { type: "number" }],
            enum: ["a", "b"],
          },
        },
      },
    ],
    messages: [
      {
        role: "assistant",
        tool_calls: [{ function: { name: "mcp:read.file" } }],
      },
    ],
  };

  const { changed, names } = fitTools(body);
  assert.equal(changed, true);
  const fn = (body.tools[0] as any).function;
  assert.equal(fn.name, "mcp_read_file");
  assert.equal(names.get("mcp_read_file"), "mcp:read.file");
  assert.equal((body.messages[0] as any).tool_calls[0].function.name, "mcp_read_file");
  assert.equal(fn.parameters.pattern, "test\\u0000end");
  assert.deepEqual(fn.parameters.items, { anyOf: [{ type: "string" }, { type: "number" }] });
});

test("sanitizeToolChoice converts OpenAI object format to string", () => {
  const b1: any = { tool_choice: "none", tools: [{ name: "t" }] };
  sanitizeToolChoice(b1);
  assert.equal(b1.tool_choice, undefined);
  assert.equal(b1.tools, undefined);

  const b2: any = { tool_choice: { type: "function", function: { name: "search" } } };
  sanitizeToolChoice(b2);
  assert.equal(b2.tool_choice, "search");

  const b3: any = { tool_choice: { type: "auto" } };
  sanitizeToolChoice(b3);
  assert.equal(b3.tool_choice, "auto");
});

test("sanitizeWorkbuddyBody handles system prompt injection, token aliases and Gemini turn alignment", () => {
  const input = {
    max_completion_tokens: 1024,
    messages: [
      { role: "developer", content: "x-anthropic-billing-header: test\nAct as expert" },
      { role: "user", content: "solve this" },
      { role: "assistant", tool_calls: [{ id: "c1", function: { name: "tool" } }] },
      { role: "tool", tool_call_id: "c1", content: "result" },
      { role: "user", content: "next instruction" },
    ],
  };

  const out = sanitizeWorkbuddyBody(input) as any;
  assert.equal(out.max_tokens, 1024);
  assert.equal(out.max_completion_tokens, undefined);
  assert.equal(out.messages[0].role, "system");
  assert.equal(out.messages[0].content, "Act as expert");

  // Gemini turn alignment check: empty assistant message padded before user message
  const lastToolIdx = out.messages.findIndex((m: any) => m.role === "tool");
  assert.equal(out.messages[lastToolIdx + 1].role, "assistant");
  assert.equal(out.messages[lastToolIdx + 1].content, "");
  assert.equal(out.messages[lastToolIdx + 2].role, "user");
  assert.equal(out.messages[lastToolIdx + 2].content, "next instruction");
});
