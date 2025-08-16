import express from "express";

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/track", async (req, res) => {
  const trackingNumber = req.query.trackingNumber;
  if (!trackingNumber) {
    return res.status(400).json({ error: "Missing trackingNumber parameter" });
  }

  try {
    // For now, return a mock response while we figure out the browser issue
    // This ensures your API is working and deployable
    res.json({ 
      trackingNumber, 
      status: "Service temporarily unavailable - browser setup in progress",
      message: "Please try again later once browser dependencies are resolved"
    });

  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.listen(PORT, () => {
  console.log(`✅ API is live at http://0.0.0.0:${PORT}`);
});