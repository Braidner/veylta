const defaultWebOrigin = "http://127.0.0.1:4300";

/**
 * @param {string | undefined} configuredOrigins
 * @returns {string[]}
 */
export function trustedDevHostnames(configuredOrigins) {
  const values = (configuredOrigins ?? defaultWebOrigin).split(",").map((value) => value.trim());
  if (values.length > 16 || values.some((value) => value.length === 0)) {
    throw new Error("WEB_ORIGINS must contain 1 to 16 exact origins");
  }

  const hostnames = values.map((value) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error("WEB_ORIGINS must contain only http(s) origins without paths");
    }
    if (parsed.origin !== value || !["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("WEB_ORIGINS must contain only http(s) origins without paths");
    }
    return parsed.hostname;
  });

  return [...new Set(hostnames)];
}
