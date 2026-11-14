const sharp = require("sharp");

module.exports = async (req) => {
  const reqUrl = new URL(req.url);
  const targetUrl = reqUrl.searchParams.get("url");

  if (!targetUrl) {
    return new Response("bandwidth-hero-proxy", { status: 200 });
  }

  const useJpeg   = reqUrl.searchParams.get("jpeg") === "1";
  const grayscale = reqUrl.searchParams.get("bw") === "1";
  const quality   = Math.min(Math.max(parseInt(reqUrl.searchParams.get("l") || reqUrl.searchParams.get("quality") || "50", 10), 10), 100);
  const maxWidth  = parseInt(reqUrl.searchParams.get("max_width") || "0", 10);

  try {
    const parsed = new URL(targetUrl);
    const res = await fetch(targetUrl, {
      headers: {
        "user-agent": req.headers.get("user-agent") || "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36",
        "referer": req.headers.get("referer") || `${parsed.origin}/`,
        ...(req.headers.get("cookie") ? { cookie: req.headers.get("cookie") } : {}),
      },
      redirect: "follow",
    });

    if (!res.ok) {
      return new Response("", { status: res.status });
    }

    const inputBuffer = Buffer.from(await res.arrayBuffer());

    let pipeline = sharp(inputBuffer, { failOn: "none" });
    if (grayscale) pipeline = pipeline.grayscale();
    if (maxWidth > 0) pipeline = pipeline.resize({ width: maxWidth, withoutEnlargement: true });

    const outputBuffer = useJpeg
      ? await pipeline.jpeg({ quality, mozjpeg: false }).toBuffer()
      : await pipeline.webp({ quality, effort: 2 }).toBuffer();

    return new Response(outputBuffer, {
      status: 200,
      headers: {
        "content-type": useJpeg ? "image/jpeg" : "image/webp",
        "cache-control": "public, max-age=604800",
      },
    });
  } catch (err) {
    return new Response(err.message || "Error", { status: 500 });
  }
};
