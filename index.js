import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { URL } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Safer rate limiting configuration
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  validate: { trustProxy: false } // Disable trust proxy for rate limiting
});

app.use(limiter);
app.use(cors());
app.use(express.json());
app.set('trust proxy', 1); // Trust first proxy only

// Content type detector
const getContentType = (url, headers) => {
  if (headers['content-type']) return headers['content-type'];
  
  if (url.match(/\.m3u8($|\?)/i)) return 'application/vnd.apple.mpegurl';
  if (url.match(/\.ts($|\?)/i)) return 'video/mp2t';
  if (url.match(/\.(vtt|srt|ass)($|\?)/i)) return 'text/vtt';
  return 'application/octet-stream';
};

// URL rewriter for HLS playlists
const rewriteHlsUrls = (content, baseUrl) => {
  const urlObj = new URL(baseUrl);
  const basePath = `${urlObj.protocol}//${urlObj.host}${urlObj.pathname.replace(/\/[^/]*$/, '/')}`;

  return content.split('\n').map(line => {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') return line;
    
    // Handle absolute URLs
    if (line.match(/^https?:\/\//)) {
      return `/proxy?url=${encodeURIComponent(line)}`;
    }
    
    // Handle relative URLs
    if (line.match(/^[^/]+\.(m3u8|ts|vtt|srt|ass)/)) {
      return `/proxy?url=${encodeURIComponent(new URL(line, basePath).href)}`;
    }
    
    return line;
  }).join('\n');
};

// Main proxy endpoint
app.get("/proxy", async (req, res) => {
  try {
    const url = decodeURIComponent(req.query.url);
    if (!url) return res.status(400).send("Missing URL parameter");

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': '*/*',
        'Referer': new URL(url).origin,
        'Origin': new URL(url).origin,
        'Range': req.headers.range || ''
      },
      timeout: 25000 // 25s timeout (under Railway's 30s limit)
    });

    const contentType = getContentType(url, response.headers);
    res.set('Content-Type', contentType);

    // Special handling for HLS playlists
    if (contentType.includes('mpegurl')) {
      const rewritten = rewriteHlsUrls(response.data.toString(), url);
      return res.send(rewritten);
    }

    // Special handling for subtitles
    if (contentType.includes('vtt') || contentType.includes('x-ass')) {
      res.set('Cache-Control', 'public, max-age=3600'); // 1 hour cache
      return res.send(response.data.toString());
    }

    // Default handling for TS segments and other files
    res.set('Cache-Control', 'public, max-age=86400'); // 1 day cache
    res.send(Buffer.from(response.data));

  } catch (err) {
    console.error(`Proxy error for ${req.query.url}:`, err.message);
    
    if (err.response?.status === 410) {
      return res.status(410).send("Stream URL has expired");
    }
    
    res.status(500).send("Proxy error: " + err.message);
  }
});

// Health check endpoint
app.get('/', (req, res) => res.send('HLS Proxy Service Running'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Proxy running on port ${PORT}`);
});
