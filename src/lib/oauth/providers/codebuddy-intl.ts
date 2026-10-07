import { CODEBUDDY_INTL_CONFIG } from "../constants/oauth";
import { codebuddyCn } from "./codebuddy-cn";

/**
 * CodeBuddy International (codebuddy.ai) — device-auth flow.
 * Re-binds the shared CodeBuddy device flow to the international configuration.
 */
export const codebuddyIntl = {
  config: CODEBUDDY_INTL_CONFIG,
  flowType: "device_code" as const,
  requestDeviceCode: (config = CODEBUDDY_INTL_CONFIG) => codebuddyCn.requestDeviceCode(config as any),
  pollToken: (config = CODEBUDDY_INTL_CONFIG, deviceCode: string) => codebuddyCn.pollToken(config as any, deviceCode),
  mapTokens: codebuddyCn.mapTokens,
};

export default codebuddyIntl;
