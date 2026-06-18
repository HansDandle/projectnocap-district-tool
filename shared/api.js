/**
 * Shared API logic for the No Cap district tool.
 *
 * Returns standard Web `Response` objects, so the same code runs unchanged on
 * Cloudflare Workers and Vercel Edge Functions. Both endpoints proxy U.S. Census
 * services that can't be called from the browser:
 *   - geocoding.geo.census.gov  -> sends NO Access-Control-Allow-Origin (CORS blocked)
 *   - tigerweb.geo.census.gov   -> returns HTTP 400 unless a Referer header is present
 *
 * Population is intentionally NOT fetched from api.census.gov (it 302s to a
 * "Missing Key" page and has no CORS). The client computes each district's
 * population as state_pop / state_seats — the legal equal-population standard.
 */

const GEOCODER =
  "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const TIGERWEB =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer/0/query";
const TRACTS =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Census2020/MapServer/6/query";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function preflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

/** GET /api/district?q=<address or ZIP> */
export async function districtResponse(url) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return json({ error: "Enter an address or ZIP code." }, 400);

  // 1. Resolve to coordinates. A bare 5-digit ZIP goes to a ZIP-centroid
  //    lookup (the Census address geocoder won't match a ZIP on its own);
  //    anything else goes to the Census address geocoder.
  let lng, lat, matchedAddress;
  let approxZip = false;

  if (/^\d{5}$/.test(q)) {
    let zip;
    try {
      const r = await fetch(`https://api.zippopotam.us/us/${q}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`zip ${r.status}`);
      zip = await r.json();
    } catch (e) {
      return json(
        { error: `We couldn't find ZIP code ${q}. Double-check it, or enter a full address.` },
        404
      );
    }
    const place = zip?.places?.[0];
    if (!place) {
      return json(
        { error: `We couldn't find ZIP code ${q}. Double-check it, or enter a full address.` },
        404
      );
    }
    lat = parseFloat(place.latitude);
    lng = parseFloat(place.longitude);
    matchedAddress = `${place["place name"]}, ${place["state abbreviation"]} ${q}`;
    approxZip = true;
  } else {
    let geo;
    try {
      const r = await fetch(
        `${GEOCODER}?address=${encodeURIComponent(q)}` +
          `&benchmark=Public_AR_Current&format=json`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!r.ok) throw new Error(`geocoder ${r.status}`);
      geo = await r.json();
    } catch (e) {
      return json(
        { error: "The Census geocoder is unavailable right now. Please try again." },
        502
      );
    }

    const matches = geo?.result?.addressMatches;
    if (!matches || matches.length === 0) {
      return json(
        {
          error:
            "We couldn't find that address. Try adding a city and state, or use a full 5-digit ZIP.",
        },
        404
      );
    }

    const m = matches[0];
    lng = m.coordinates.x;
    lat = m.coordinates.y;
    matchedAddress = m.matchedAddress;
  }

  // 2. Coordinates -> congressional district + boundary (119th Congress).
  let district;
  try {
    const tigerUrl =
      `${TIGERWEB}?geometry=${lng},${lat}` +
      `&geometryType=esriGeometryPoint&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects&outFields=*` +
      `&returnGeometry=true&outSR=4326&f=geojson`;
    const r = await fetch(tigerUrl, {
      headers: { Referer: "https://tigerweb.geo.census.gov/" },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw new Error(`tigerweb ${r.status}`);
    district = await r.json();
  } catch (e) {
    return json(
      { error: "The district boundary service is unavailable right now. Please try again." },
      502
    );
  }

  const feature = district?.features?.[0];
  if (!feature || !feature.properties?.GEOID) {
    return json(
      {
        error:
          "That location isn't inside a U.S. congressional district (it may be a territory or offshore).",
      },
      404
    );
  }

  // GEOID = 2-digit state FIPS + 2-digit district code.
  const geoid = String(feature.properties.GEOID);
  const statefp = geoid.slice(0, 2);
  const cdCode = geoid.slice(2);

  return json({
    matchedAddress,
    approxZip, // true when resolved from a ZIP centroid (ZIPs can span districts)
    lat,
    lng,
    statefp,
    cdCode, // "00"/"98" = at-large or non-voting delegate; else district number
    geoid,
    geojson: district, // FeatureCollection with the district polygon
  });
}

/**
 * GET /api/tracts?bbox=minLng,minLat,maxLng,maxLat&state=NN
 * 2020 Census tracts (geometry + POP100) intersecting the bbox, optionally
 * filtered to one state FIPS so a drawn district never crosses a state line.
 */
export async function tractsResponse(url) {
  const bbox = (url.searchParams.get("bbox") || "").trim();
  const state = (url.searchParams.get("state") || "").trim();
  if (!/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(bbox)) {
    return json({ error: "bbox must be minLng,minLat,maxLng,maxLat" }, 400);
  }

  let data;
  try {
    // maxAllowableOffset generalizes geometry server-side (~50 m). Invisible at
    // district zoom, but cuts the payload ~20x (910 KB -> ~42 KB) and the client
    // union from ~500 ms to under 100 ms. The client keeps only the largest
    // unioned part and strips holes, so leftover gaps don't create inner lines.
    const t =
      `${TRACTS}?geometry=${bbox}&geometryType=esriGeometryEnvelope&inSR=4326` +
      `&spatialRel=esriSpatialRelIntersects&outFields=GEOID,POP100` +
      `&returnGeometry=true&maxAllowableOffset=0.0005&outSR=4326&f=geojson`;
    const r = await fetch(t, {
      headers: { Referer: "https://tigerweb.geo.census.gov/" },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`tracts ${r.status}`);
    data = await r.json();
  } catch (e) {
    return json({ error: "The tract service is unavailable right now." }, 502);
  }

  if (state && Array.isArray(data.features)) {
    data.features = data.features.filter(
      (f) => String(f.properties?.GEOID || "").slice(0, 2) === state
    );
  }
  return json(data);
}
