import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OPENCODE_USER_AGENT,
  forwardOpencodeClientHeaders,
  resolveOpencodeCliDefaults,
  satisfiesOpencodeUserAgentContract,
} from "../../open-sse/utils/opencodeHeaders.ts";
import { OPENCODE_CLI_VERSION_FALLBACK } from "../../open-sse/utils/opencodeCliVersion.ts";
import {
  placeholderToolDescription,
  placeholderToolParameters,
  sanitizeToolChoice,
} from "../../open-sse/utils/opencodeFingerprintSchemas.ts";

test("v2 User-Agent and fallback CLI version pin", () => {
  assert.equal(DEFAULT_OPENCODE_USER_AGENT, "opencode/latest/2.0.26/cli");
  assert.equal(OPENCODE_CLI_VERSION_FALLBACK, "2.0.26");
});

test("UA contract check enforces major version >= 2 and rejects legacy 1.18.x", () => {
  assert.equal(satisfiesOpencodeUserAgentContract(DEFAULT_OPENCODE_USER_AGENT), true);
  assert.equal(satisfiesOpencodeUserAgentContract("opencode/latest/2.0.26/cli"), true);
  assert.equal(satisfiesOpencodeUserAgentContract("opencode/2.0.0"), true);
  assert.equal(satisfiesOpencodeUserAgentContract("opencode/beta/2.0.26/cli"), true);
  assert.equal(
    satisfiesOpencodeUserAgentContract("opencode/latest/2.0.26/cli ai-sdk/provider-utils/4.0.23"),
    true
  );

  // Legacy v1 clients must be rejected
  assert.equal(satisfiesOpencodeUserAgentContract("opencode/1.18.31"), false);
  assert.equal(satisfiesOpencodeUserAgentContract("opencode/1.17.0"), false);
  assert.equal(satisfiesOpencodeUserAgentContract("opencode/beta/1.18.31/cli"), false);
  assert.equal(satisfiesOpencodeUserAgentContract("opencode/1.16.0"), false);
  assert.equal(satisfiesOpencodeUserAgentContract("opencode-cli/1.0.0"), false);
  assert.equal(satisfiesOpencodeUserAgentContract("opencode"), false);
  assert.equal(satisfiesOpencodeUserAgentContract("curl/8.5.0"), false);
  assert.equal(satisfiesOpencodeUserAgentContract(undefined), false);
});

test("free-tier header synthesis omits x-opencode-request and mirrors session headers", () => {
  const headers: Record<string, string> = {};
  const defaults = resolveOpencodeCliDefaults("opencode", true);
  assert.ok(defaults);
  assert.equal(defaults.client, "cli");
  assert.match(defaults.userAgent, /^opencode\/latest\/\d+\.\d+\.\d+\/cli$/);

  forwardOpencodeClientHeaders(
    headers,
    { "x-opencode-request": "msg_0001020304051234567890ABCD" },
    {
      cliDefaults: defaults,
      reencodeSession: true,
    }
  );

  // x-opencode-request is omitted
  assert.equal(headers["x-opencode-request"], undefined);

  // Session headers mirrored
  const session = headers["x-opencode-session"];
  assert.ok(session && session.startsWith("ses_"));
  assert.equal(headers["x-opencode-session-id"], session);
  assert.equal(headers["x-session-affinity"], session);
  assert.equal(headers["x-session-id"], session);
});

test("non-gated header synthesis preserves x-opencode-request", () => {
  const headers: Record<string, string> = {};
  const defaults = resolveOpencodeCliDefaults("opencode", false);
  assert.ok(defaults);

  forwardOpencodeClientHeaders(
    headers,
    { "x-opencode-request": "msg_0123456789ab0123456789cdef" },
    {
      cliDefaults: defaults,
      reencodeSession: false,
    }
  );

  assert.equal(headers["x-opencode-request"], "msg_0123456789ab0123456789cdef");
  assert.equal(headers["x-opencode-session-id"], undefined);
});

test("placeholder tools provide verbatim v2.0.26 CLI schemas for read and shell", () => {
  const readParams = placeholderToolParameters("read") as {
    type: string;
    properties: Record<string, { type: string }>;
    required: string[];
    additionalProperties?: boolean;
  };
  assert.equal(readParams.type, "object");
  assert.deepEqual(readParams.required, ["path"]);
  assert.equal(readParams.additionalProperties, false);
  assert.ok("path" in readParams.properties);
  assert.ok("offset" in readParams.properties);
  assert.ok("limit" in readParams.properties);

  const shellParams = placeholderToolParameters("shell") as {
    type: string;
    properties: Record<string, { type: string }>;
    required: string[];
    additionalProperties?: boolean;
  };
  assert.equal(shellParams.type, "object");
  assert.deepEqual(shellParams.required, ["command"]);
  assert.equal(shellParams.additionalProperties, false);
  assert.ok("command" in shellParams.properties);
  assert.ok("workdir" in shellParams.properties);
  assert.ok("timeout" in shellParams.properties);
  assert.ok("background" in shellParams.properties);

  const readDesc = placeholderToolDescription("read");
  assert.match(readDesc, /^Read the contents of a file or directory\./);

  const shellDesc = placeholderToolDescription("shell");
  assert.match(shellDesc, /^Execute a shell command and return its output\./);
});

test("sanitizeToolChoice strips tool_choice none", () => {
  const stringNone = sanitizeToolChoice({ messages: [], tool_choice: "none" });
  assert.equal("tool_choice" in stringNone, false);

  const objNone = sanitizeToolChoice({ messages: [], tool_choice: { type: "none" } });
  assert.equal("tool_choice" in objNone, false);

  const auto = sanitizeToolChoice({ messages: [], tool_choice: "auto" });
  assert.equal(auto.tool_choice, "auto");
});

