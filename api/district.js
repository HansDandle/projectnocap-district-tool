import { districtResponse, preflight } from "../shared/api.js";

export const config = { runtime: "edge" };

export default function handler(request) {
  if (request.method === "OPTIONS") return preflight();
  return districtResponse(new URL(request.url));
}
