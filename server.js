// server.js
// ENSO Signal API - x402-gated endpoint serving live El Nino/La Nina status,
// strength, trend, empirical persistence, and sector impact scores.

require("dotenv").config();
const express = require("express");
const { paymentMiddleware } = require("x402-express");
const { getEnsoSignal } = require("./lib/enso");

const app = express();

const RECEIVER_ADDRESS = process.env.RECEIVER_ADDRESS; // your payout wallet (Base mainnet)
const PRICE = process.env.PRICE_USD || "$0.02";
const NETWORK = process.env.X402_NETWORK || "base"; // "base-sepolia" for testnet

if (!RECEIVER_ADDRESS) {
  console.warn("WARNING: RECEIVER_ADDRESS env var is not set. Payments cannot be received.");
}

app.use(
  paymentMiddleware(
    RECEIVER_ADDRESS,
    {
      "GET /enso": {
        price: PRICE,
        network: NETWORK,
        config: {
          description:
            "Live ENSO (El Nino/La Nina) status, strength, trend, empirical persistence odds, and sector impact scores (agriculture, supply chain, insurance, energy), synthesized from NOAA CPC RONI/ONI records.",
          outputSchema: {
            type: "object",
            properties: {
              generated_at: { type: "string", format: "date-time" },
              enso_status: { type: "string", enum: ["el_nino", "la_nina", "neutral"] },
              alert_level: { type: "string" },
              current_season: { type: "string" },
              roni_anomaly: { type: "number" },
              oni_anomaly: { type: "number" },
              latest_weekly_nino34_anomaly: { type: "number" },
              latest_weekly_date: { type: "string" },
              strength: { type: "string" },
              strength_score: { type: "number", minimum: 0, maximum: 100 },
              trajectory: { type: "string", enum: ["strengthening", "weakening", "steady"] },
              trend_last_6_seasons: { type: "array" },
              persistence_empirical: { type: "object" },
              historical_analog: { type: "object" },
              sector_impacts: { type: "object" },
              methodology: { type: "string" },
              sources: { type: "object" },
            },
          },
        },
      },
    },
    { url: process.env.FACILITATOR_URL || "https://x402.org/facilitator" }
  )
);

app.get("/enso", async (req, res) => {
  try {
    const signal = await getEnsoSignal();
    res.json(signal);
  } catch (err) {
    console.error("ENSO signal computation failed:", err);
    res.status(502).json({ error: "upstream_data_unavailable", detail: String(err.message || err) });
  }
});

app.get("/", (req, res) => {
  res.json({
    name: "ENSO Signal API",
    description: "Pay-per-call live El Nino/La Nina status with computed sector impact scores.",
    endpoint: "GET /enso",
    price: PRICE,
    network: NETWORK,
    protocol: "x402",
  });
});

module.exports = app;

// Allow `node server.js` for local testing outside Vercel.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`ENSO Signal API listening on :${port}`));
}
