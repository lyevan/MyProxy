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

    // Special handling for megastatics subtitles
    if (url.includes('megastatics.com')) {
      const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'text/vtt, */*',
          'Referer': 'https://megastatics.com/',
          'Origin': 'https://megastatics.com/',
            'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'cross-site'
        }
      });

      // Pipe the subtitle stream directly
      res.set({
        'Content-Type': 'text/vtt; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*'
      });
      return response.data.pipe(res);
    }

    // Original HLS handling
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': '*/*',
        'Referer': new URL(url).origin
      }
    });

    const contentType = getContentType(url, response.headers);
    res.set('Content-Type', contentType);

    if (contentType.includes('mpegurl')) {
      const rewritten = rewriteHlsUrls(response.data.toString(), url);
      return res.send(rewritten);
    }

    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(response.data));

  } catch (err) {
    console.error(`Proxy error: ${err.message}`);
    res.status(500).send("Proxy error");
  }
});

// Health check endpoint
app.get('/', (req, res) => res.send('HLS Proxy Service Running'));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Proxy running on port ${PORT}`);
});
