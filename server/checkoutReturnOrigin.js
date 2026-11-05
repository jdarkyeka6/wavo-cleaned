// Checkout return URLs must come from deployment configuration, not HTTP
// Origin/Host/X-Forwarded-Host headers, which may be untrusted.
export function getCheckoutReturnOrigin(configuredUrl = process.env.WAVO_PUBLIC_ORIGIN) {
  const url = new URL(configuredUrl || "https://www.wavo.lol");
  if (url.protocol !== "https:" || url.username || url.password
      || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Wavo checkout origin configuration must be a clean HTTPS origin");
  }
  return url.origin;
}
