import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import { URL } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors()); // enables CORS for all origins

// Proxy route
app.get("/proxy", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("Missing 'url' parameter");

  try {
    const response = await axios.get(url, {
      responseType: "stream",
      headers: {
        // Optional: Add custom headers if needed
        "User-Agent": req.get("User-Agent") || "",
        Range: req.get("Range") || "",
      },
    });

    // Forward headers
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }

    // Add CORS & streaming support headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Expose-Headers",
      "Content-Length, Content-Range, Accept-Ranges"
    );

    response.data.pipe(res);
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).send("Proxy error");
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
