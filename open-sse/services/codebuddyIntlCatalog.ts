import {
  fetchCodeBuddyCatalog,
  clearCodeBuddyCatalogCache,
} from "../executors/codebuddy-intl/catalogFetch.ts";

/**
 * Route-facing boundary for the CodeBuddy International model catalog.
 *
 * `src/app/**` is forbidden from importing `open-sse/executors/**` directly
 * (eslint `no-restricted-imports`: executor implementations must stay behind an
 * open-sse handler or service boundary). This module is that boundary: it owns
 * the translation from the catalog's native model shape to the shape the
 * `/api/providers/[id]/models` route persists and returns, so the route never
 * has to know how the catalog is fetched.
 *
 * Fetch semantics (cache, TTL, timeout, never-throws) live in `catalogFetch.ts`;
 * this layer adds no behaviour beyond the shape mapping.
 */

export interface CodeBuddyCatalogModel {
  id: string;
  name: string;
  contextLength?: number;
  maxOutputTokens?: number;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
}

export interface CodeBuddyCatalogResult {
  ok: boolean;
  cached: boolean;
  models: CodeBuddyCatalogModel[];
  status?: number;
  error?: string;
}

export interface DiscoverCodeBuddyModelsOptions {
  accessToken: string;
  accountKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  now?: number;
}

/**
 * Discover the account's model list. Never throws: a failed catalog fetch
 * returns `ok: false` with an empty list so the caller keeps its curated
 * fallback instead of showing an empty picker.
 */
export async function discoverCodeBuddyIntlModels(
  options: DiscoverCodeBuddyModelsOptions
): Promise<CodeBuddyCatalogResult> {
  const result = await fetchCodeBuddyCatalog({
    accessToken: options.accessToken,
    accountKey: options.accountKey,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    ttlMs: options.ttlMs,
    now: options.now,
  });

  const models: CodeBuddyCatalogModel[] = result.models.map((model) => ({
    id: model.id,
    name: model.name,
    ...(model.contextWindow ? { contextLength: model.contextWindow } : {}),
    ...(model.maxTokens ? { maxOutputTokens: model.maxTokens } : {}),
    ...(model.vision ? { supportsVision: true } : {}),
    ...(model.reasoning ? { supportsReasoning: true } : {}),
  }));

  return {
    ok: result.ok,
    cached: result.cached,
    models,
    ...(result.status !== undefined ? { status: result.status } : {}),
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
}

/** Drop the cached catalog (tests and account removal). */
export function clearCodeBuddyIntlModelCache(): void {
  clearCodeBuddyCatalogCache();
}
