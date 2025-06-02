import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { URL } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

//Try to load environment variables from .env file
// Middleware for compression
app.use(compression());

// CORS configuration
app.use(cors());
app.use(express.json());

app.set("trust proxy", 1); // Trust first proxy only

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
//  app.use(limiter);

// Content type detector
const getContentType = (url, headers) => {
  if (headers["content-type"]) return headers["content-type"];

  if (url.match(/\.m3u8($|\?)/i)) return "application/vnd.apple.mpegurl";
  if (url.match(/\.ts($|\?)/i)) return "video/mp2t";
  if (url.match(/\.(vtt|srt|ass)($|\?)/i)) return "text/vtt";
  return "application/octet-stream";
};

// URL rewriter for HLS playlists
const rewriteHlsUrls = (content, baseUrl) => {
  const urlObj = new URL(baseUrl);
  const basePath = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.replace(
    /\/[^/]*$/,
    "/"
  )}`;

  return content
    .split("\n")
    .map((line) => {
      // Skip comments and empty lines
      if (line.startsWith("#") || line.trim() === "") return line;

      // Handle absolute URLs
      if (line.match(/^https?:\/\//)) {
        return `/proxy?url=${encodeURIComponent(line)}`;
      }

      // Handle relative URLs
      if (line.match(/^[^/]+\.(m3u8|ts|vtt|srt|ass)/)) {
        return `/proxy?url=${encodeURIComponent(new URL(line, basePath).href)}`;
      }

      return line;
    })
    .join("\n");
};

// Proxy endpoint
app.get("/proxy", async (req, res) => {
  const encodedUrl = req.query.url;
  if (!encodedUrl) return res.status(400).send("Missing URL parameter");

  const url = decodeURIComponent(encodedUrl);

  try {
    const response = await axios.get(url, {
      responseType: url.includes(".ts") ? "stream" : "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "*/*",
        Referer: new URL(url).origin,
      },
    });

    const contentType = getContentType(url, response.headers);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=86400");

    // Handle .m3u8 playlists
    if (contentType.includes("mpegurl")) {
      const rewritten = rewriteHlsUrls(response.data.toString(), url);
      return res.send(rewritten);
    }

    // Stream .ts and other media directly
    if (response.data.pipe) {
      return response.data.pipe(res);
    }

    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error(`Proxy error: ${err.message}`);
    res.status(500).send("Proxy error");
  }
});

// Health check endpoint
app.get("/", (req, res) => res.send("HLS Proxy Service Running"));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Proxy running on port ${PORT}`);
});
