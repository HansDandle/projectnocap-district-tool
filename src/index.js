/**
 * Project No Cap — District Calculator Worker (Cloudflare).
 *
 * Serves the static page (via the ASSETS binding) and the two JSON endpoints.
 * The actual endpoint logic lives in ../shared/api.js so it stays identical to
 * the Vercel deployment.
 */
import { districtResponse, tractsResponse, preflight } from "../shared/api.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/district") {
      return request.method === "OPTIONS" ? preflight() : districtResponse(url);
    }
    if (url.pathname === "/api/tracts") {
      return request.method === "OPTIONS" ? preflight() : tractsResponse(url);
    }

    // Everything else: static assets (the page itself).
    return env.ASSETS.fetch(request);
  },
};
