import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { URL } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});
app.use(limiter);

// Middleware
app.use(cors());
app.use(express.json());
app.enable("trust proxy");

// HTTPS enforcement
app.use((req, res, next) => {
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    next();
  } else {
    res.redirect(`https://${req.headers.host}${req.url}`);
  }
});

// Proxy route (unchanged from your working version)
app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing 'url' parameter");

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0",
        Accept: "*/*",
        Referer: new URL(url).origin,
      },
    });

    res.set({
      "Content-Type":
        response.headers["content-type"] || "application/octet-stream",
      "Cache-Control": "public, max-age=86400",
    });
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error(`Proxy error: ${err.message}`);
    res.status(500).send("Proxy error");
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Server Error");
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Proxy running on port ${PORT}`);
});
