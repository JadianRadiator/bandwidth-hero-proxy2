/**
 * Bandwidth Hero Proxy — Netlify Serverless Function
 *
 * Original proxy concept: ayastreb/bandwidth-hero-proxy (MIT)
 * Serverless port:        adi-g15/bandwidth-hero-proxy (MIT)
 * This repo:              himshim/bandwidth-hero-proxy2 (MIT)
 */

const fetch          = require("node-fetch");
const shouldCompress = require("../util/shouldCompress");
const compress       = require("../util/compress");

const DEFAULT_QUALITY = 40;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=604800, max-age=3600, stale-while-revalidate=86400",
};

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function isPrivateHost(hostname) {
  return [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^169\.254\./,
    /^::1$/,
  ].some((p) => p.test(hostname));
}

function fetchWithTimeout(url, options, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("FETCH_TIMEOUT")), ms)
  );
  return Promise.race([fetch(url, options), timeout]);
}

exports.handler = async (e) => {
  if (e.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }

  let { url: r } = e.queryStringParameters;
  const { jpeg: s, bw: o, quality: q, l, max_width: mw } = e.queryStringParameters;

  if (!r) {
    return { statusCode: 200, headers: CORS_HEADERS, body: "bandwidth-hero-proxy" };
  }

  try { r = JSON.parse(r); } catch {}
  Array.isArray(r) && (r = r.join("&url="));
  r = r.replace(/http:\/\/1\.1\.\d\.\d\/bmi\/(https?:\/\/)?/i, "http://");

  if (!isValidUrl(r)) {
    return { statusCode: 400, headers: CORS_HEADERS, body: "Invalid URL" };
  }
  const parsedUrl = new URL(r);
  if (isPrivateHost(parsedUrl.hostname)) {
    return { statusCode: 403, headers: CORS_HEADERS, body: "Forbidden" };
  }

  const useWebp   = s !== "1";
  const grayscale = o === "1";
  const quality   = parseInt(q || l, 10) || DEFAULT_QUALITY;
  const maxWidth  = parseInt(mw, 10) || 0;

  try {
    let body, contentType;

    const forwardHeaders = {
      "user-agent":
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24"',
      "sec-ch-ua-mobile": "?1",
      "sec-ch-ua-platform": '"Android"',
      "sec-fetch-dest": "image",
      "sec-fetch-mode": "no-cors",
      "sec-fetch-site": "cross-site",
      "referer": e.headers["referer"] || `${parsedUrl.origin}/`,
    };

    if (e.headers["cookie"]) {
      forwardHeaders["cookie"] = e.headers["cookie"];
    }

    console.log("Fetching:", r, "Incoming Referer:", e.headers["referer"] || "NONE");

    try {
      const response = await fetchWithTimeout(
        r,
        {
          headers: forwardHeaders,
          redirect: "follow",
        },
        8000
      );

      if (!response.ok) {
        console.log("Upstream failed with status:", response.status, "for URL:", r);
        return { statusCode: response.status || 302, headers: CORS_HEADERS, body: "" };
      }

      body        = await response.buffer();
      contentType = response.headers.get("content-type") || "";

    } catch (fetchErr) {
      if (fetchErr.message === "FETCH_TIMEOUT") {
        return { statusCode: 504, headers: CORS_HEADERS, body: "Upstream fetch timed out" };
      }
      throw fetchErr;
    }

    if (contentType && !contentType.startsWith("image/")) {
      console.log("Non-image content-type:", contentType, "for URL:", r);
      return {
        statusCode: 415,
        headers:    CORS_HEADERS,
        body:       `Upstream returned non-image response (${contentType})`,
      };
    }

    const originalSize = body.length;

    if (!shouldCompress(contentType, originalSize, useWebp)) {
      console.log("Bypassing compression. Size:", originalSize);
      return {
        statusCode:      200,
        body:            body.toString("base64"),
        isBase64Encoded: true,
        headers: {
          ...CORS_HEADERS,
          ...CACHE_HEADERS,
          "content-type": contentType || "image/jpeg",
        },
      };
    }

    const { err, output, headers: compressedHeaders } = await compress(
      body, useWebp, grayscale, quality, originalSize, maxWidth
    );

    if (err) {
      console.log("Compression failed:", r);
      throw err;
    }

    console.log(
      `From ${originalSize}, saved: ${((originalSize - output.length) / originalSize * 100).toFixed(1)}%`
    );

    return {
      statusCode:      200,
      body:            output.toString("base64"),
      isBase64Encoded: true,
      headers: {
        ...CORS_HEADERS,
        ...CACHE_HEADERS,
        "content-type": useWebp ? "image/webp" : "image/jpeg",
        ...compressedHeaders,
      },
    };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers: CORS_HEADERS, body: err.message || "" };
  }
};
