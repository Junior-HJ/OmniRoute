import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProviderCard from "../ProviderCard";
import NoAuthProvidersSection from "../NoAuthProvidersSection";

vi.mock("next-intl", () => ({
  useTranslations: () => (k: string) => k,
}));
vi.mock("@/shared/components/ProviderTestSlideOver", () => ({ default: () => null }));
vi.mock("@/shared/components/ProviderIcon", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

describe("NoAuth Providers — inline toggle & bulk disable/enable", () => {
  let container: HTMLDivElement | null = null;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    if (container) {
      document.body.removeChild(container);
      container = null;
    }
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("ProviderCard renders Toggle for no-auth even when stats.total === 0", () => {
    const onToggle = vi.fn();
    const root = createRoot(container!);
    act(() => {
      root.render(
        <ProviderCard
          providerId="devin-cli-agentic"
          provider={{
            id: "devin-cli-agentic",
            name: "Devin CLI Agentic",
            serviceKinds: [],
          }}
          stats={{ total: 0, connected: 0, error: 0, warning: 0 }}
          authType="no-auth"
          onToggle={onToggle}
        />
      );
    });

    const toggle = container!.querySelector('button[role="switch"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-checked")).toBe("true");

    act(() => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("ProviderCard hides Toggle for apikey when stats.total === 0", () => {
    const root = createRoot(container!);
    act(() => {
      root.render(
        <ProviderCard
          providerId="openai"
          provider={{
            id: "openai",
            name: "OpenAI",
            serviceKinds: [],
          }}
          stats={{ total: 0, connected: 0, error: 0, warning: 0 }}
          authType="apikey"
          onToggle={() => {}}
        />
      );
    });

    const toggle = container!.querySelector('button[role="switch"]');
    expect(toggle).toBeNull();
  });

  it("NoAuthProvidersSection bulk disables all visible providers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ blockedProviders: ["devin-cli-agentic"] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock;

    const onBlockedChange = vi.fn();
    const onError = vi.fn();
    const root = createRoot(container!);

    act(() => {
      root.render(
        <NoAuthProvidersSection
          visibleEntries={[
            {
              providerId: "devin-cli-agentic",
              provider: { name: "Devin CLI Agentic", alias: "dva" },
              stats: { total: 0 },
              toggleAuthType: "no-auth",
            } as any,
          ]}
          count={{ configured: 0, total: 1 }}
          blockedEntries={[]}
          blockedProviders={[]}
          onBlockedChange={onBlockedChange}
          onError={onError}
          testingMode={null}
          onBatchTest={() => {}}
          onToggleProvider={() => {}}
        />
      );
    });

    const buttons = Array.from(container!.querySelectorAll("button"));
    const disableAllBtn = buttons.find((b) => b.textContent?.includes("disable"));
    expect(disableAllBtn).toBeDefined();

    await act(async () => {
      disableAllBtn?.click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ blockedProviders: ["devin-cli-agentic"] }),
      })
    );
    expect(onBlockedChange).toHaveBeenCalledWith(["devin-cli-agentic"]);
  });

  it("NoAuthProvidersSection bulk enables all blocked providers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ blockedProviders: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    globalThis.fetch = fetchMock;

    const onBlockedChange = vi.fn();
    const onError = vi.fn();
    const root = createRoot(container!);

    act(() => {
      root.render(
        <NoAuthProvidersSection
          visibleEntries={[]}
          count={{ configured: 0, total: 1 }}
          blockedEntries={[
            {
              providerId: "devin-cli-agentic",
              provider: { name: "Devin CLI Agentic", alias: "dva" },
              stats: { total: 0 },
              toggleAuthType: "no-auth",
            } as any,
          ]}
          blockedProviders={["devin-cli-agentic", "dva"]}
          onBlockedChange={onBlockedChange}
          onError={onError}
          testingMode={null}
          onBatchTest={() => {}}
          onToggleProvider={() => {}}
        />
      );
    });

    const buttons = Array.from(container!.querySelectorAll("button"));
    const enableAllBtn = buttons.find((b) => b.textContent?.includes("enable"));
    expect(enableAllBtn).toBeDefined();

    await act(async () => {
      enableAllBtn?.click();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/settings",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ blockedProviders: [] }),
      })
    );
    expect(onBlockedChange).toHaveBeenCalledWith([]);
  });
});
