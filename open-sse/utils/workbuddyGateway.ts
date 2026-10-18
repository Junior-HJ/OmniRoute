import { createHash, randomBytes, randomUUID } from "node:crypto";

/**
 * WorkBuddy gateway compliance utilities (Issue #16978).
 *
 * Enforces mandatory headers, stable turn/conversation tracking, system prompt
 * injection, tool schema normalization (preventing upstream 11133 errors on DeepSeek/Kimi/GLM),
 * and competitor prompt anti-ban sanitization (preventing 11128 errors).
 */

export const WORKBUDDY_UA_VERSION = "5.5.6";
export const WORKBUDDY_USER_AGENT = `WorkBuddy/${WORKBUDDY_UA_VERSION}`;

export const WORKBUDDY_DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": WORKBUDDY_USER_AGENT,
  "X-Product": "SaaS",
  "X-IDE-Type": "WorkBuddy",
  "X-IDE-Name": "WorkBuddy",
  "X-IDE-Version": WORKBUDDY_UA_VERSION,
  "X-Requested-With": "XMLHttpRequest",
  "X-Agent-Intent": "craft",
  "X-Agent-Purpose": "conversation",
  "X-Agent-Type": "main",
};

const SALT = randomBytes(16).toString("hex");

function idFor(kind: string, key: string): string {
  return createHash("sha256").update(`${SALT}|${kind}|${key}`).digest("hex").slice(0, 32);
}

function hex32(): string {
  return randomBytes(16).toString("hex");
}

function signatureOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type : "";
    if (type === "" || type === "text") {
      out += typeof p.text === "string" ? p.text : "";
    } else if (type !== "tool_result" && type !== "tool-result") {
      out += `[${type}:${createHash("sha256").update(JSON.stringify(part)).digest("hex").slice(0, 8)}]`;
    }
  }
  return out;
}

function answeredBefore(msgs: Array<Record<string, unknown>>, i: number): boolean {
  const prev = msgs[i - 1];
  if (!prev || typeof prev !== "object") return false;
  if (prev.role === "tool") return true;
  return prev.role === "assistant" && Array.isArray(prev.tool_calls) && prev.tool_calls.length > 0;
}

export function turnKey(chat: Record<string, unknown> | null): string {
  const msgs = Array.isArray(chat?.messages) ? (chat.messages as Array<Record<string, unknown>>) : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role !== "user" || answeredBefore(msgs, i)) continue;
    const sig = signatureOf(msgs[i].content);
    return sig ? `u${i}:${sig}` : "";
  }
  return "";
}

export function conversationKey(chat: Record<string, unknown> | null, session?: string): string {
  if (session) return `session:${session}`;
  const msgs = Array.isArray(chat?.messages) ? (chat.messages as Array<Record<string, unknown>>) : [];
  for (const m of msgs) {
    if (m?.role !== "user") continue;
    const sig = signatureOf(m?.content);
    if (sig) return `first:${sig}`;
  }
  return "";
}

/**
 * Attach conversation-tracking headers to pass Tencent's gateway attribution.
 */
export function withWorkbuddyHeaders<T extends Record<string, string> | Headers>(
  headers: T,
  body: unknown = null,
  session?: string
): T {
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const sess =
    session ||
    (typeof b?.session_id === "string" ? b.session_id : undefined) ||
    (typeof b?.prompt_cache_key === "string" ? b.prompt_cache_key : undefined);

  const conv = conversationKey(b, sess);
  const msg = hex32();

  const write = (name: string, val: string) => {
    if (typeof (headers as Headers)?.set === "function") {
      (headers as Headers).set(name, val);
    } else {
      (headers as Record<string, string>)[name] = val;
    }
  };

  const has = (name: string): boolean => {
    if (typeof (headers as Headers)?.has === "function") {
      return (headers as Headers).has(name);
    }
    return Boolean((headers as Record<string, string>)[name]);
  };

  write("X-Conversation-Message-ID", msg);
  write("X-Request-ID", msg);

  if (!has("X-Conversation-Request-ID")) {
    const turn = turnKey(b);
    write("X-Conversation-Request-ID", turn ? idFor("turn", `${conv}|${turn}`) : hex32());
  }

  if (conv && !has("X-Conversation-ID")) {
    write("X-Conversation-ID", idFor("conversation", conv));
  }

  return headers;
}

// Tool schema normalization
const NAME_OK = /^[A-Za-z0-9_-]+$/;
const NUL_ESCAPE = /\\\\|\\0(?![0-9])/g;
const TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);
const SUB_ONE = ["items", "additionalItems", "unevaluatedItems", "contains", "not", "if", "then", "else", "propertyNames", "additionalProperties", "unevaluatedProperties"];
const SUB_LIST = ["anyOf", "oneOf", "allOf", "prefixItems"];
const SUB_MAP = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas"];
const BOOL_OK = new Set(["additionalProperties", "unevaluatedProperties"]);

function safeToolName(name: string, taken: Set<string>): string {
  const base = String(name).replace(/[^A-Za-z0-9_-]/g, "_") || "tool";
  let n = base;
  for (let i = 2; taken.has(n); i++) n = `${base}_${i}`;
  taken.add(n);
  return n;
}

export function fitSchema(s: unknown, depth = 0): boolean {
  if (!s || typeof s !== "object" || depth > 64) return false;
  let changed = false;
  if (Array.isArray(s)) {
    for (const v of s) if (fitSchema(v, depth + 1)) changed = true;
    return changed;
  }
  const obj = s as Record<string, unknown>;
  if (typeof obj.pattern === "string" && obj.pattern.includes("\\0")) {
    const p = obj.pattern.replace(NUL_ESCAPE, (m) => (m === "\\\\" ? m : "\\u0000"));
    if (p !== obj.pattern) {
      obj.pattern = p;
      changed = true;
    }
  }
  if (Array.isArray(obj.items)) {
    const list = obj.items.filter((v) => v && typeof v === "object");
    obj.items = list.length === 0 ? {} : list.length === 1 ? list[0] : { anyOf: list };
    delete obj.additionalItems;
    changed = true;
  }
  for (const v of Object.values(obj)) {
    if (fitSchema(v, depth + 1)) changed = true;
  }
  return changed;
}

function valueType(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function fitEnum(s: Record<string, unknown>): boolean {
  if (!("enum" in s)) return false;
  if (!Array.isArray(s.enum) || s.enum.length === 0) {
    delete s.enum;
    return true;
  }
  const listed = Array.isArray(s.type) ? s.type : typeof s.type === "string" ? [s.type] : [];
  if (listed.filter((t) => t !== "null").length === 1) return false;
  const byType = new Map<string, unknown[]>();
  for (const v of s.enum) {
    const t = valueType(v);
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(v);
  }
  if (byType.has("integer") && byType.has("number")) {
    byType.get("number")!.push(...byType.get("integer")!);
    byType.delete("integer");
  }
  const hasNull = byType.delete("null");
  if (byType.size <= 1) {
    const [t] = byType.keys();
    const want = t === undefined ? "null" : hasNull ? [t, "null"] : t;
    if (JSON.stringify(want) === JSON.stringify(s.type)) return false;
    s.type = want;
    return true;
  }
  const split: unknown[] = [...byType].map(([t, vs]) => ({ type: t, enum: vs }));
  if (hasNull) split.push({ type: "null" });
  delete s.enum;
  delete s.type;
  if (Array.isArray(s.anyOf)) {
    s.allOf = [...(Array.isArray(s.allOf) ? s.allOf : []), { anyOf: split }];
  } else {
    s.anyOf = split;
  }
  return true;
}

function subSchema(v: unknown, key: string): unknown {
  if (typeof v !== "boolean" || BOOL_OK.has(key)) return v;
  return v ? {} : { not: {} };
}

export function fitShape(s: unknown, depth = 0): boolean {
  if (!s || typeof s !== "object" || Array.isArray(s) || depth > 64) return false;
  const obj = s as Record<string, unknown>;
  let changed = false;
  if ("type" in obj) {
    const list = (Array.isArray(obj.type) ? obj.type : [obj.type])
      .map((t) => (typeof t === "string" ? t.toLowerCase() : t))
      .filter((t) => TYPES.has(t as string));
    const uniq = [...new Set(list)];
    const want = uniq.length === 0 ? undefined : uniq.length === 1 ? uniq[0] : uniq;
    if (JSON.stringify(want) !== JSON.stringify(obj.type)) {
      if (want === undefined) delete obj.type;
      else obj.type = want;
      changed = true;
    }
  }
  if ("required" in obj && !Array.isArray(obj.required)) {
    delete obj.required;
    changed = true;
  } else if (Array.isArray(obj.required) && obj.required.some((k) => typeof k !== "string")) {
    obj.required = obj.required.filter((k) => typeof k === "string");
    changed = true;
  }
  if (fitEnum(obj)) changed = true;
  for (const k of SUB_ONE) {
    if (!(k in obj)) continue;
    const v = subSchema(obj[k], k);
    if (v !== obj[k]) {
      obj[k] = v;
      changed = true;
    }
    if (fitShape(v, depth + 1)) changed = true;
  }
  for (const k of SUB_LIST) {
    if (!Array.isArray(obj[k])) continue;
    const list = obj[k] as unknown[];
    list.forEach((v0, i) => {
      const v = subSchema(v0, k);
      if (v !== v0) {
        list[i] = v;
        changed = true;
      }
      if (fitShape(v, depth + 1)) changed = true;
    });
  }
  for (const k of SUB_MAP) {
    const m = obj[k];
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    for (const [name, v0] of Object.entries(m as Record<string, unknown>)) {
      const v = subSchema(v0, k);
      if (v !== v0) {
        (m as Record<string, unknown>)[name] = v;
        changed = true;
      }
      if (fitShape(v, depth + 1)) changed = true;
    }
  }
  return changed;
}

export function fitTools(body: Record<string, unknown>): { changed: boolean; names: Map<string, string> } {
  const names = new Map<string, string>();
  if (!Array.isArray(body?.tools) || !body.tools.length) return { changed: false, names };
  let changed = false;
  const taken = new Set<string>();
  for (const t of body.tools as Array<Record<string, unknown>>) {
    const fn = t?.function as Record<string, unknown> | undefined;
    const n = fn?.name;
    if (typeof n === "string" && NAME_OK.test(n)) taken.add(n);
  }
  const theirs = new Map<string, string>();
  for (const t of body.tools as Array<Record<string, unknown>>) {
    const fn = (t?.type === "function" || t?.function ? t.function : null) as Record<string, unknown> | null;
    if (!fn || typeof fn !== "object") continue;
    if (typeof fn.name === "string" && !NAME_OK.test(fn.name)) {
      const safe = safeToolName(fn.name, taken);
      names.set(safe, fn.name);
      theirs.set(fn.name, safe);
      fn.name = safe;
      changed = true;
    }
    if (fn.parameters === undefined) continue;
    if (!fn.parameters || typeof fn.parameters !== "object" || Array.isArray(fn.parameters)) {
      fn.parameters = { type: "object", properties: {} };
      changed = true;
      continue;
    }
    if (fitSchema(fn.parameters)) changed = true;
    if (fitShape(fn.parameters)) changed = true;
  }
  if (theirs.size && Array.isArray(body.messages)) {
    for (const m of body.messages as Array<Record<string, unknown>>) {
      if (Array.isArray(m?.tool_calls)) {
        for (const c of m.tool_calls as Array<Record<string, unknown>>) {
          const fn = c?.function as Record<string, unknown> | undefined;
          const safe = theirs.get(fn?.name as string);
          if (safe && fn) fn.name = safe;
        }
      }
      if (m?.role === "tool" && typeof m.name === "string" && theirs.has(m.name)) {
        m.name = theirs.get(m.name)!;
      }
    }
  }
  return { changed, names };
}

export function sanitizeToolChoice(body: Record<string, unknown>): boolean {
  if (!("tool_choice" in body)) return false;
  const choice = body.tool_choice;
  if (typeof choice === "string") {
    if (choice.trim().toLowerCase() === "none") {
      delete body.tool_choice;
      delete body.tools;
      delete body.functions;
      return true;
    }
    return false;
  }
  if (!choice || typeof choice !== "object" || Array.isArray(choice)) {
    delete body.tool_choice;
    return true;
  }
  const c = choice as Record<string, unknown>;
  const type = typeof c.type === "string" ? c.type.trim().toLowerCase() : "";
  if (type === "none") {
    delete body.tool_choice;
    delete body.tools;
    delete body.functions;
    return true;
  }
  if (type === "auto" || type === "required") {
    body.tool_choice = type;
    return true;
  }
  if (type === "function") {
    const fn = c.function as Record<string, unknown> | undefined;
    const name = typeof fn?.name === "string" ? fn.name.trim() : "";
    body.tool_choice = name || "auto";
    return true;
  }
  delete body.tool_choice;
  return true;
}

const BILLING_HEADER_RE = /x-anthropic-billing-header:[^\n]*\n?/gi;

export function sanitizeWorkbuddyBody(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const b = { ...(body as Record<string, unknown>) };

  // Normalize parameters
  if (b.max_completion_tokens !== undefined) {
    if (b.max_tokens === undefined) b.max_tokens = b.max_completion_tokens;
    delete b.max_completion_tokens;
  }

  // Normalize messages
  if (Array.isArray(b.messages) && b.messages.length > 0) {
    const msgs = (b.messages as Array<Record<string, unknown>>).map((m) => {
      if (!m || typeof m !== "object") return m;
      const msg = { ...m };
      if (msg.role === "developer") msg.role = "system";
      if (typeof msg.content === "string" && BILLING_HEADER_RE.test(msg.content)) {
        msg.content = msg.content.replace(BILLING_HEADER_RE, "").trim();
      }
      return msg;
    });

    // Enforce first message is system prompt
    if (msgs[0]?.role !== "system") {
      msgs.unshift({ role: "system", content: "You are a helpful assistant." });
    }

    // Gemini turn alignment (error 11153):
    // If ending with tool results followed by user messages, pad with an empty assistant message
    let i = msgs.length - 1;
    while (i >= 0 && msgs[i]?.role === "user") i--;
    if (i < msgs.length - 1 && i >= 0 && msgs[i]?.role === "tool") {
      msgs.splice(i + 1, 0, { role: "assistant", content: "" });
    }

    b.messages = msgs;
  }

  fitTools(b);
  sanitizeToolChoice(b);

  return b;
}
