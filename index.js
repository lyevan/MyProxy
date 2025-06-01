import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { URL } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Enhanced CORS configuration
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "https://myproxy-production-b8b4.up.railway.app",
    /\.yourdomain\.com$/,
  ],
  methods: ["GET", "HEAD"],
  allowedHeaders: ["Content-Type", "Range"],
  exposedHeaders: ["Content-Length", "Content-Range"],
  maxAge: 86400,
};

app.use(cors(corsOptions));

// Improved rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 250,
  validate: { trustProxy: false },
  skip: (req) => {
    // Skip rate limiting for subtitle requests
    return req.query.url?.includes("vtt") || req.query.url?.includes("srt");
  },
});

app.use(limiter);
app.use(express.json());
app.set("trust proxy", 1);

// Content type detector with more formats
const getContentType = (url, headers) => {
  const contentType = headers["content-type"]?.split(";")[0];
  if (contentType) return contentType;

  if (url.match(/\.(m3u8)($|\?)/i)) return "application/vnd.apple.mpegurl";
  if (url.match(/\.(ts|m2ts)($|\?)/i)) return "video/mp2t";
  if (url.match(/\.(vtt)($|\?)/i)) return "text/vtt";
  if (url.match(/\.(srt)($|\?)/i)) return "text/plain";
  if (url.match(/\.(ass|ssa)($|\?)/i)) return "text/x-ass";
  if (url.match(/\.(mp4|m4v)($|\?)/i)) return "video/mp4";
  return "application/octet-stream";
};

// Enhanced URL rewriter with fragment handling
const rewriteHlsUrls = (content, baseUrl) => {
  try {
    const urlObj = new URL(baseUrl);
    const basePath = `${urlObj.protocol}//${
      urlObj.host
    }${urlObj.pathname.replace(/\/[^/]*$/, "/")}`;

    return content
      .split("\n")
      .map((line) => {
        if (line.startsWith("#") || line.trim() === "") return line;

        // Handle URI fragments
        if (line.startsWith("#EXT-X-MAP:URI=")) {
          const uri = line.match(/URI="([^"]+)"/)[1];
          const resolvedUri = new URL(uri, basePath).href;
          return line.replace(
            uri,
            `/proxy?url=${encodeURIComponent(resolvedUri)}`
          );
        }

        if (line.match(/^https?:\/\//)) {
          return `/proxy?url=${encodeURIComponent(line)}`;
        }

        if (line.match(/^[^/]+\.(m3u8|ts|vtt|srt|ass|mp4|m4v)/)) {
          return `/proxy?url=${encodeURIComponent(
            new URL(line, basePath).href
          )}`;
        }

        return line;
      })
      .join("\n");
  } catch (e) {
    console.error("URL rewriting error:", e.message);
    return content; // Fallback to original content if rewriting fails
  }
};

// Proxy middleware with enhanced security
const proxyHandler = async (req, res) => {
  try {
    const url = decodeURIComponent(req.query.url);
    if (!url) return res.status(400).json({ error: "Missing URL parameter" });

    // Validate URL format
    if (!url.match(/^https?:\/\//)) {
      return res.status(400).json({ error: "Invalid URL format" });
    }

    const isSubtitle = url.match(/\.(vtt|srt|ass|ssa)($|\?)/i);
    const isHls = url.match(/\.(m3u8|ts)($|\?)/i);

    // Configure request headers
    const headers = {
      "User-Agent": "Mozilla/5.0",
      Accept: isSubtitle ? "text/vtt, */*" : "*/*",
      Referer: new URL(url).origin,
      Origin: new URL(url).origin,
      ...(req.headers.range && { Range: req.headers.range }),
    };

    // Special handling for different content types
    if (isSubtitle) {
      const response = await axios({
        method: "get",
        url,
        responseType: "stream",
        headers,
        timeout: 10000,
      });

      res.set({
        "Content-Type": getContentType(url, response.headers),
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Length",
      });

      return response.data.pipe(res);
    }

    // HLS and other content handling
    const response = await axios.get(url, {
      responseType: isHls ? "text" : "arraybuffer",
      headers,
      timeout: 15000,
    });

    const contentType = getContentType(url, response.headers);
    res.set("Content-Type", contentType);

    if (contentType.includes("mpegurl")) {
      const rewritten = rewriteHlsUrls(
        isHls ? response.data : response.data.toString(),
        url
      );
      return res.send(rewritten);
    }

    res.set("Cache-Control", isHls ? "no-cache" : "public, max-age=86400");
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error(`Proxy error: ${err.message}`);

    if (err.response) {
      res.set(err.response.headers);
      return res.status(err.response.status).send(err.response.data);
    }

    res.status(500).json({
      error: "Proxy error",
      message: err.message,
      ...(err.code && { code: err.code }),
    });
  }
};

// API endpoints
app.get("/proxy", proxyHandler);

// Health check with version info
app.get("/", (req, res) =>
  res.json({
    status: "running",
    version: "1.2.0",
    endpoints: {
      proxy: "/proxy?url={encodedUrl}",
    },
  })
);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err.stack);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Proxy server running on port ${PORT}`);
  console.log(`🌐 CORS allowed for: ${corsOptions.origin.join(", ")}`);
});
