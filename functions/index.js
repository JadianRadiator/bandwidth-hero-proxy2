const fetch = require("node-fetch");
const sharp = require("sharp");

exports.handler = async (e) => {
  const params = e.queryStringParameters || {};
  const targetUrl = params.url;

  if (!targetUrl) {
    return { statusCode: 200, body: "bandwidth-hero-proxy" };
  }

  const useJpeg  = params.jpeg === "1";
  const grayscale = params.bw === "1";
  const quality  = Math.min(Math.max(parseInt(params.l || params.quality || "50", 10), 10), 100);
  const maxWidth = parseInt(params.max_width || "0", 10);

  try {
    const parsed = new URL(targetUrl);
    const res = await fetch(targetUrl, {
      headers: {
        "user-agent": e.headers["user-agent"] || "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36",
        "referer": e.headers["referer"] || `${parsed.origin}/`,
        ...(e.headers["cookie"] ? { cookie: e.headers["cookie"] } : {}),
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return { statusCode: res.status, body: "" };
    }

    const inputBuffer = await res.buffer();

    let pipeline = sharp(inputBuffer, { failOn: "none" });
    if (grayscale) pipeline = pipeline.grayscale();
    if (maxWidth > 0) pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });

    const outputBuffer = useJpeg
      ? await pipeline.jpeg({ quality, mozjpeg: false }).toBuffer()
      : await pipeline.webp({ quality, effort: 2 }).toBuffer();

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "content-type": useJpeg ? "image/jpeg" : "image/webp",
        "cache-control": "public, max-age=604800",
      },
      body: outputBuffer.toString("base64"),
    };
  } catch (err) {
    return { statusCode: 500, body: err.message || "Error" };
  }
};
