import { getRequestConfig } from "next-intl/server";

import messages from "../../messages/en.json";

/*
 * English only in the MVP (SPEC 3.1). Every user-facing string lives in
 * messages/en.json so another language can be added without code changes.
 * Business time zone is Africa/Monrovia (D-06).
 */
export const DEFAULT_LOCALE = "en";
export const BUSINESS_TIME_ZONE = "Africa/Monrovia";

export default getRequestConfig(async () => ({
  locale: DEFAULT_LOCALE,
  messages,
  timeZone: BUSINESS_TIME_ZONE,
}));
