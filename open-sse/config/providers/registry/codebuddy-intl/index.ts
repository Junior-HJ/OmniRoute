import { CODEBUDDY_INTL_USER_AGENT } from "../../../providerHeaderProfiles.ts";
import type { RegistryEntry } from "../../shared.ts";

/**
 * CodeBuddy International (codebuddy.ai).
 *
 * Unified OpenAI-compatible gateway behind the CodeBuddy International service.
 * Carries 15 models (GLM, Kimi, MiniMax, DeepSeek, Hunyuan) and reasons via
 * OpenAI-style `reasoning_effort` (not vendor-native thinking shapes). Streaming
 * is forced by the executor because non-stream requests are rejected with code 11101.
 *
 * Short alias "cbai" matches the reserved alias convention.
 */
export const codebuddy_intlProvider: RegistryEntry = {
  id: "codebuddy-intl",
  alias: "cbai",
  format: "openai",
  executor: "codebuddy-intl",
  baseUrl: "https://www.codebuddy.ai/v2/chat/completions",
  authType: "oauth",
  authHeader: "bearer",
  headers: {
    "User-Agent": CODEBUDDY_INTL_USER_AGENT,
    "X-Product": "SaaS",
    "X-IDE-Type": "IDE",
    "X-IDE-Name": "IDE",
    "x-requested-with": "XMLHttpRequest",
    "x-codebuddy-request": "1",
  },
  models: [
    {
      id: "glm-5.2",
      name: "GLM-5.2",
      contextLength: 1000000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5.1",
      name: "GLM-5.1",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5.0",
      name: "GLM-5.0",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5.0-turbo",
      name: "GLM-5.0-Turbo",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "glm-5v-turbo",
      name: "GLM-5v-Turbo",
      contextLength: 200000,
      maxOutputTokens: 38000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "glm-4.7",
      name: "GLM-4.7",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
    },
    {
      id: "minimax-m3",
      name: "MiniMax-M3",
      contextLength: 512000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "minimax-m2.7",
      name: "MiniMax-M2.7",
      contextLength: 200000,
      maxOutputTokens: 48000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k2.7",
      name: "Kimi-K2.7-Code",
      contextLength: 256000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k2.6",
      name: "Kimi-K2.6",
      contextLength: 256000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "kimi-k2.5",
      name: "Kimi-K2.5",
      contextLength: 164000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "hy3-preview",
      name: "Hy3 Preview",
      contextLength: 192000,
      maxOutputTokens: 64000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek-V4-Pro",
      contextLength: 1000000,
      maxOutputTokens: 50000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "deepseek-v4.1-flash",
      name: "DeepSeek-V4.1-Flash",
      contextLength: 1000000,
      maxOutputTokens: 50000,
      supportsReasoning: true,
      supportsVision: true,
    },
    {
      id: "deepseek-v3-2-volc",
      name: "DeepSeek-V3.2",
      contextLength: 96000,
      maxOutputTokens: 32000,
      supportsReasoning: true,
    },
  ],
};

export default codebuddy_intlProvider;
