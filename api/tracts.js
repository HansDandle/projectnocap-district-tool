import { tractsResponse, preflight } from "../shared/api.js";

export const config = { runtime: "edge" };

export default function handler(request) {
  if (request.method === "OPTIONS") return preflight();
  return tractsResponse(new URL(request.url));
}
