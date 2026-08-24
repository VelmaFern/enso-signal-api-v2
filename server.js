// server.js
// ENSO Signal API - x402 v2-gated endpoint serving live El Nino/La Nina status,
// strength, trend, empirical persistence, and sector impact scores.
//
// Migrated from x402-express (v1 protocol) to @x402/express (v2 protocol).
// v2 is required for x402scan.com discovery listing; the v1 version remains
// live and untouched at the original enso-signal-api deployment.

require("dotenv").config();
const express = require("express");
const { paymentMiddleware } = require("@x402/express");
const { x402ResourceServer, HTTPFacilitatorClient } = require("@x402/core/server");
const { ExactEvmScheme } = require("@x402/evm/exact/server");
const { declareDiscoveryExtension } = require("@x402/extensions/bazaar");
const { facilitator } = require("@coinbase/x402"); // CDP's official facilitator config
const { getEnsoSignal } = require("./lib/enso");

const app = express();

const RECEIVER_ADDRESS = process.env.RECEIVER_ADDRESS; // your payout wallet (Base mainnet)
const PRICE = process.env.PRICE_USD || "$0.02";
// v2 networks use CAIP-2 identifiers. eip155:8453 = Base mainnet, eip155:84532 = Base Sepolia testnet.
const CAIP2_NETWORK =
  process.env.X402_NETWORK === "base-sepolia" ? "eip155:84532" : "eip155:8453";

if (!RECEIVER_ADDRESS) {
  console.warn("WARNING: RECEIVER_ADDRESS env var is not set. Payments cannot be received.");
}
if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
  console.warn(
    "WARNING: CDP_API_KEY_ID/CDP_API_KEY_SECRET are not set. Mainnet payments will not verify/settle without them."
  );
}

// Facilitator client wraps CDP's facilitator config (reads CDP_API_KEY_ID/SECRET from env).
const facilitatorClient = new HTTPFacilitatorClient(facilitator);

// Resource server registers which payment schemes/networks this app accepts.
const resourceServer = new x402ResourceServer(facilitatorClient).register(
  CAIP2_NETWORK,
  new ExactEvmScheme()
);

const ensoOutputSchema = {
  type: "object",
  properties: {
    generated_at: { type: "string", format: "date-time" },
    enso_status: { type: "string", enum: ["el_nino", "la_nina", "neutral"] },
    alert_level: { type: "string" },
    current_season: { type: "string" },
    roni_anomaly: { type: "number" },
    oni_anomaly: { type: "number" },
    latest_weekly_nino34_anomaly: { type: "number" },
    latest_weekly_month: { type: "string" },
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
};

app.use(
  paymentMiddleware(
    {
      "GET /enso": {
        accepts: [
          {
            scheme: "exact",
            price: PRICE,
            network: CAIP2_NETWORK,
            payTo: RECEIVER_ADDRESS,
          },
        ],
        description:
          "Live ENSO (El Nino/La Nina) status, strength, trend, empirical persistence odds, and sector impact scores (agriculture, supply chain, insurance, energy), synthesized from NOAA CPC RONI/ONI records",
        mimeType: "application/json",
        extensions: {
          ...declareDiscoveryExtension({
            method: "GET",
            output: {
              example: {
                enso_status: "el_nino",
                strength: "weak",
                strength_score: 41,
                trajectory: "strengthening",
              },
              schema: ensoOutputSchema,
            },
          }),
        },
      },
    },
    resourceServer
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
    network: CAIP2_NETWORK,
    protocol: "x402 v2",
  });
});

module.exports = app;

// Allow `node server.js` for local testing outside Vercel.
if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`ENSO Signal API (v2) listening on :${port}`));
}
