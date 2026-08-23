// lib/enso.js
// Fetches NOAA CPC ENSO data sources and computes the insight layer.
// Data sources (all free, public, no API key):
//   RONI.ascii.txt  - Relative Oceanic Nino Index, official NOAA index (adopted Feb 2026)
//   oni.ascii.txt   - Oceanic Nino Index (legacy/cross-check, same Nino 3.4 region)
//   sstoi.indices   - weekly-updated raw Nino region SST + anomalies

const RONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/RONI.ascii.txt";
const ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt";
const SSTOI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/sstoi.indices";

const SEASON_ORDER = [
  "DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ",
  "JJA", "JAS", "ASO", "SON", "OND", "NDJ",
];

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "enso-signal-api/1.0 (x402 data endpoint)" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status}`);
  }
  return res.text();
}

// Parses "SEAS YR ANOM" or "SEAS YR TOTAL ANOM" style CPC ascii tables.
function parseSeasonalTable(text) {
  const tokens = text.trim().split(/\s+/);
  // Header is always "SEAS YR ANOM" (RONI, stride 3) or "SEAS YR TOTAL ANOM" (ONI, stride 4).
  // Can't detect header length by numeric-ness alone since SEAS values (DJF, JFM...) are
  // non-numeric too - use the literal header tokens instead.
  const hasTotal = tokens[2] === "TOTAL";
  const stride = hasTotal ? 4 : 3;
  let i = stride; // skip the header row itself

  const rows = [];
  for (; i + stride - 1 < tokens.length; i += stride) {
    const seas = tokens[i];
    const yr = Number(tokens[i + 1]);
    const anom = hasTotal ? Number(tokens[i + 3]) : Number(tokens[i + 2]);
    if (!SEASON_ORDER.includes(seas) || Number.isNaN(yr) || Number.isNaN(anom)) continue;
    rows.push({ seas, yr, anom });
  }
  return rows;
}

// Parses the weekly sstoi.indices fixed-format table.
// Columns: YR MON DAY  NINO1+2 ANOM  NINO3 ANOM  NINO4 ANOM  NINO3.4 ANOM
function parseWeeklyTable(text) {
  const lines = text.trim().split("\n").slice(1); // skip header row
  const rows = [];
  for (const line of lines) {
    const p = line.trim().split(/\s+/).map(Number);
    if (p.length < 10) continue;
    const [yr, mon, day] = p;
    if (!yr || Number.isNaN(yr)) continue;
    rows.push({
      yr, mon, day,
      nino12: p[3], nino12_anom: p[4],
      nino3: p[5], nino3_anom: p[6],
      nino4: p[7], nino4_anom: p[8],
      nino34: p[9], nino34_anom: p[10],
    });
  }
  return rows;
}

function seasonIndex(seas, yr) {
  return yr * 12 + SEASON_ORDER.indexOf(seas);
}

function classifyStatus(anom) {
  if (anom >= 0.5) return "el_nino";
  if (anom <= -0.5) return "la_nina";
  return "neutral";
}

// NOAA's standard ONI-magnitude strength bins, applied to the anomaly.
function classifyStrength(anom) {
  const a = Math.abs(anom);
  if (a < 0.5) return { strength: "none", strength_rank: 0 };
  if (a < 1.0) return { strength: "weak", strength_rank: 1 };
  if (a < 1.5) return { strength: "moderate", strength_rank: 2 };
  if (a < 2.0) return { strength: "strong", strength_rank: 3 };
  return { strength: "very_strong", strength_rank: 4 };
}

// Sector impact synthesis: a deterministic function of live status + strength,
// built from documented ENSO teleconnection patterns. This is the irreplaceable
// layer — turning a raw anomaly number into decision-relevant sector risk.
function computeSectorImpacts(status, strengthRank, anom) {
  const intensity = Math.min(1, strengthRank / 4); // 0..1

  if (status === "el_nino") {
    return {
      agriculture: {
        risk_score: Math.round(40 + intensity * 50),
        label: intensity > 0.6 ? "high" : intensity > 0.25 ? "elevated" : "moderate",
        hotspots: ["Southeast Asia", "Australia", "Southern Africa", "Northeast Brazil"],
        signal: "Drought risk in the western Pacific rim and parts of southern Africa/Brazil; wetter-than-normal in parts of South America.",
      },
      supply_chain: {
        risk_score: Math.round(35 + intensity * 45),
        label: intensity > 0.6 ? "elevated" : "moderate",
        hotspots: ["Panama Canal (freshwater draft limits)", "Indonesian archipelago shipping", "US Gulf barge routes"],
        signal: "Reduced rainfall in the Panama Canal watershed historically forces draft/transit restrictions during strong events.",
      },
      insurance: {
        hurricane_atlantic_risk: intensity > 0.4 ? "reduced" : "near_normal",
        hurricane_epac_risk: intensity > 0.4 ? "elevated" : "near_normal",
        flood_risk_regions: ["California", "US Gulf Coast", "Peru/Ecuador coast", "East Africa"],
        drought_risk_regions: ["Australia", "Indonesia", "India (monsoon)", "Southern Africa"],
      },
      energy: {
        hydropower_risk: intensity > 0.4 ? "elevated" : "moderate",
        heating_demand_outlook: "below_normal_northern_hemisphere_winter",
      },
    };
  }

  if (status === "la_nina") {
    return {
      agriculture: {
        risk_score: Math.round(35 + intensity * 45),
        label: intensity > 0.6 ? "high" : intensity > 0.25 ? "elevated" : "moderate",
        hotspots: ["US Southern Plains/Midwest", "Argentina/Southern Brazil", "Horn of Africa"],
        signal: "Drought risk for US Southern Plains and southern South America grain belts; wetter in Australia/Southeast Asia.",
      },
      supply_chain: {
        risk_score: Math.round(30 + intensity * 40),
        label: intensity > 0.6 ? "elevated" : "moderate",
        hotspots: ["Mississippi River barge draft", "Argentine grain export terminals"],
        signal: "Low Mississippi River levels have historically constrained barge tonnage during La Niña winters.",
      },
      insurance: {
        hurricane_atlantic_risk: intensity > 0.4 ? "elevated" : "near_normal",
        hurricane_epac_risk: intensity > 0.4 ? "reduced" : "near_normal",
        flood_risk_regions: ["Australia", "Southeast Asia", "Northern South America"],
        drought_risk_regions: ["US Southwest/Southern Plains", "Southern South America", "Horn of Africa"],
      },
      energy: {
        hydropower_risk: intensity > 0.4 ? "elevated_variability" : "moderate",
        heating_demand_outlook: "above_normal_northern_us_and_canada",
      },
    };
  }

  return {
    agriculture: { risk_score: 20, label: "low", hotspots: [], signal: "No strong ENSO-driven regional signal; near-climatological risk." },
    supply_chain: { risk_score: 15, label: "low", hotspots: [], signal: "No material ENSO-driven disruption expected." },
    insurance: { hurricane_atlantic_risk: "near_normal", hurricane_epac_risk: "near_normal", flood_risk_regions: [], drought_risk_regions: [] },
    energy: { hydropower_risk: "normal", heating_demand_outlook: "near_normal" },
  };
}

// Empirical persistence: among historical seasons with the same status,
// what fraction persisted into the next 1 and 2 seasons? Computed live
// from the full RONI history rather than quoting an external forecast.
function computePersistence(history, currentIdx) {
  const currentStatus = classifyStatus(history[currentIdx].anom);
  if (currentStatus === "neutral") return null;

  let total = 0, persisted1 = 0, persisted2 = 0;
  for (let i = 0; i < history.length - 2; i++) {
    if (classifyStatus(history[i].anom) !== currentStatus) continue;
    total++;
    if (classifyStatus(history[i + 1].anom) === currentStatus) persisted1++;
    if (classifyStatus(history[i + 2].anom) === currentStatus) persisted2++;
  }
  if (total === 0) return null;
  return {
    based_on_n_historical_seasons: total,
    persisted_next_season_pct: Math.round((persisted1 / total) * 100),
    persisted_two_seasons_later_pct: Math.round((persisted2 / total) * 100),
  };
}

// Finds the closest historical analog season by anomaly magnitude among
// seasons of the same status, excluding the last 3 years (to avoid trivial
// self-matches) and reports how that historical event evolved next.
function findHistoricalAnalog(history, currentIdx) {
  const current = history[currentIdx];
  const status = classifyStatus(current.anom);
  if (status === "neutral") return null;

  let best = null, bestDist = Infinity;
  for (let i = 0; i < history.length - 1; i++) {
    const row = history[i];
    if (row.yr >= current.yr - 3) continue;
    if (classifyStatus(row.anom) !== status) continue;
    const dist = Math.abs(row.anom - current.anom);
    if (dist < bestDist) {
      bestDist = dist;
      best = { ...row, next: history[i + 1] };
    }
  }
  if (!best) return null;
  return {
    analog_season: `${best.seas} ${best.yr}`,
    analog_anom: best.anom,
    following_season: `${best.next.seas} ${best.next.yr}`,
    following_anom: best.next.anom,
  };
}

async function getEnsoSignal() {
  const [roniText, oniText, weeklyText] = await Promise.all([
    fetchText(RONI_URL),
    fetchText(ONI_URL),
    fetchText(SSTOI_URL),
  ]);

  const roniHistory = parseSeasonalTable(roniText).sort(
    (a, b) => seasonIndex(a.seas, a.yr) - seasonIndex(b.seas, b.yr)
  );
  const oniHistory = parseSeasonalTable(oniText).sort(
    (a, b) => seasonIndex(a.seas, a.yr) - seasonIndex(b.seas, b.yr)
  );
  const weekly = parseWeeklyTable(weeklyText);

  if (roniHistory.length === 0) throw new Error("RONI parse failed");

  const currentIdx = roniHistory.length - 1;
  const current = roniHistory[currentIdx];
  const currentOni = oniHistory[oniHistory.length - 1];
  const latestWeekly = weekly[weekly.length - 1];

  const status = classifyStatus(current.anom);
  const { strength, strength_rank } = classifyStrength(current.anom);

  // Historical ceiling for scaling strength_score (computed from actual data, not hardcoded)
  const maxAbsAnom = Math.max(...roniHistory.map((r) => Math.abs(r.anom)));
  const strength_score = Math.round(
    Math.min(100, (Math.abs(current.anom) / maxAbsAnom) * 100)
  );

  // 6-season trend sparkline + trajectory label
  const recent = roniHistory.slice(-6);
  const trajectory =
    recent.length >= 2
      ? recent[recent.length - 1].anom > recent[recent.length - 2].anom
        ? "strengthening"
        : recent[recent.length - 1].anom < recent[recent.length - 2].anom
        ? "weakening"
        : "steady"
      : "steady";

  const persistence = computePersistence(roniHistory, currentIdx);
  const analog = findHistoricalAnalog(roniHistory, currentIdx);
  const sector_impacts = computeSectorImpacts(status, strength_rank, current.anom);

  return {
    generated_at: new Date().toISOString(),
    enso_status: status,
    alert_level: strength_rank >= 3 ? "advisory_strong" : strength_rank >= 1 ? "advisory" : "watch",
    current_season: `${current.seas} ${current.yr}`,
    roni_anomaly: current.anom,
    oni_anomaly: currentOni ? currentOni.anom : null,
    latest_weekly_nino34_anomaly: latestWeekly ? latestWeekly.nino34_anom : null,
    latest_weekly_date: latestWeekly ? `${latestWeekly.yr}-${String(latestWeekly.mon).padStart(2, "0")}-${String(latestWeekly.day).padStart(2, "0")}` : null,
    strength,
    strength_score,
    trajectory,
    trend_last_6_seasons: recent.map((r) => ({ season: `${r.seas} ${r.yr}`, anom: r.anom })),
    persistence_empirical: persistence,
    historical_analog: analog,
    sector_impacts,
    methodology:
      "enso_status and strength are derived from NOAA CPC's RONI (Relative Oceanic Nino Index, the official ENSO index adopted Feb 2026), cross-checked against the legacy ONI. strength_score is scaled against the full 1950-present RONI record. persistence_empirical and historical_analog are computed live from that same record (not sourced from an external forecast). sector_impacts synthesizes documented ENSO teleconnection patterns as a function of live status and strength.",
    sources: {
      roni: RONI_URL,
      oni: ONI_URL,
      weekly_sst: SSTOI_URL,
    },
  };
}

module.exports = { getEnsoSignal };
