
import { useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";

const GROUPS = {
  "Semiconductors": {
    color: "#2563eb",
    tickers: [
      { symbol: "SMH",  name: "VanEck Semiconductor ETF" },
      { symbol: "SOXX", name: "iShares Semiconductor ETF" },
      { symbol: "SOXQ", name: "Invesco PHLX Semiconductor ETF" },
    ],
  },
  "Data Centre": {
    color: "#7c3aed",
    tickers: [
      { symbol: "DTCR", name: "Global X Data Center ETF" },
      { symbol: "CHPX", name: "Themes Compute & AI ETF" },
    ],
  },
  "Energy & Power": {
    color: "#d97706",
    tickers: [
      { symbol: "XLU",  name: "Utilities Select Sector SPDR" },
      { symbol: "URA",  name: "Global X Uranium ETF" },
      { symbol: "URNM", name: "Sprott Uranium Miners ETF" },
    ],
  },
  "Cybersecurity": {
    color: "#059669",
    tickers: [
      { symbol: "CIBR", name: "First Trust NASDAQ Cybersecurity" },
      { symbol: "HACK", name: "Amplify Cybersecurity ETF" },
    ],
  },
  "Broad AI": {
    color: "#dc2626",
    tickers: [
      { symbol: "AIQ",  name: "Global X AI & Technology ETF" },
      { symbol: "QTUM", name: "Defiance Quantum ETF" },
      { symbol: "CHAT", name: "Roundhill Generative AI ETF" },
      { symbol: "IGV",  name: "iShares Expanded Tech-Software ETF" },
    ],
  },
};

const PALETTE = [
  "#2563eb","#db2777","#059669","#d97706","#7c3aed",
  "#ea580c","#0891b2","#9333ea","#ca8a04","#0284c7",
  "#65a30d","#e11d48","#6d28d9","#047857",
];

const ALL_TICKERS = Object.values(GROUPS).flatMap(g => g.tickers);
function getColor(symbol) {
  const idx = ALL_TICKERS.findIndex(t => t.symbol === symbol);
  return PALETTE[idx % PALETTE.length];
}

const TIME_RANGES = [
  { label: "1M",  months: 1  },
  { label: "3M",  months: 3  },
  { label: "6M",  months: 6  },
  { label: "1Y",  months: 12 },
  { label: "2Y",  months: 24 },
  { label: "3Y",  months: 36 },
];

const DELAY_MS = 13000; // 13s between requests → safely under 5/min limit

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchTicker(symbol, apiKey) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_WEEKLY_ADJUSTED&symbol=${symbol}&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();

  // Distinguish rate-limit vs invalid key by reading the actual message
  if (json["Note"]) throw new Error("rate_limit");
  if (json["Information"]) {
    const msg = json["Information"];
    if (msg.toLowerCase().includes("api key") || msg.toLowerCase().includes("premium")) {
      throw new Error("invalid_key: " + msg);
    }
    throw new Error("rate_limit");   // anything else in "Information" is usually rate limiting
  }

  const series = json["Weekly Adjusted Time Series"];
  if (!series) throw new Error("no_data");

  return Object.entries(series)
    .map(([date, vals]) => ({
      dateObj: new Date(date),
      date: new Date(date).toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"2-digit" }),
      close: parseFloat(parseFloat(vals["5. adjusted close"]).toFixed(2)),
    }))
    .sort((a, b) => a.dateObj - b.dateObj);
}

function filterByMonths(data, months) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return data.filter(d => d.dateObj >= cutoff);
}

function mergeAndNormalise(rawData, symbols, months) {
  const dateMap = new Map();
  symbols.forEach(sym => {
    const rows = rawData[sym] ? filterByMonths(rawData[sym], months) : [];
    rows.forEach(({ date, dateObj, close }) => {
      if (!dateMap.has(date)) dateMap.set(date, { date, dateObj });
      dateMap.get(date)[sym] = close;
    });
  });
  const sorted = [...dateMap.values()].sort((a, b) => a.dateObj - b.dateObj);

  const bases = {};
  symbols.forEach(sym => {
    const first = sorted.find(d => d[sym] != null);
    if (first) bases[sym] = first[sym];
  });
  return sorted.map(point => {
    const np = { date: point.date };
    symbols.forEach(sym => {
      if (point[sym] != null && bases[sym]) {
        np[sym] = parseFloat(((point[sym] / bases[sym]) * 100).toFixed(2));
      }
    });
    return np;
  });
}

// ── TOOLTIP ──────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].filter(p => p.value != null).sort((a, b) => b.value - a.value);
  return (
    <div style={{
      background:"#fff", border:"1px solid #e2e8f0", borderRadius:10,
      padding:"10px 14px", minWidth:160, boxShadow:"0 8px 24px rgba(0,0,0,0.12)"
    }}>
      <p style={{ color:"#94a3b8", fontSize:10, margin:"0 0 8px", letterSpacing:1 }}>{label}</p>
      {sorted.map(p => {
        const pct = (p.value - 100).toFixed(1);
        return (
          <div key={p.dataKey} style={{ display:"flex", justifyContent:"space-between", gap:14, marginBottom:3 }}>
            <span style={{ color:p.stroke, fontSize:11, fontWeight:700 }}>{p.dataKey}</span>
            <span style={{ color: parseFloat(pct) >= 0 ? "#16a34a" : "#dc2626", fontSize:11, fontWeight:600 }}>
              {parseFloat(pct) >= 0 ? "+" : ""}{pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
};

// ── SPINNER ───────────────────────────────────────────────────────────────────
const Spinner = ({ size=24 }) => (
  <>
    <style>{`@keyframes _sp{to{transform:rotate(360deg)}}`}</style>
    <div style={{
      width:size, height:size,
      border:`${size>20?3:2}px solid #e2e8f0`,
      borderTop:`${size>20?3:2}px solid #2563eb`,
      borderRadius:"50%", animation:"_sp 0.7s linear infinite", flexShrink:0
    }}/>
  </>
);

// ── SETUP SCREEN ──────────────────────────────────────────────────────────────
function SetupScreen({ onSubmit }) {
  const [key, setKey] = useState("");
  return (
    <div style={{
      minHeight:"100vh", background:"#f8fafc",
      display:"flex", alignItems:"center", justifyContent:"center",
      fontFamily:"'IBM Plex Mono','Courier New',monospace", padding:24,
    }}>
      <div style={{
        background:"#fff", borderRadius:16, border:"1px solid #e2e8f0",
        boxShadow:"0 4px 24px rgba(0,0,0,0.08)", padding:"36px 40px",
        maxWidth:500, width:"100%",
      }}>
        <div style={{ fontSize:9, letterSpacing:4, color:"#2563eb", textTransform:"uppercase", marginBottom:8 }}>
          Setup Required
        </div>
        <h2 style={{ margin:"0 0 6px", fontSize:20, color:"#0f172a", fontWeight:700 }}>
          Alpha Vantage API Key
        </h2>
        <p style={{ fontSize:11, color:"#64748b", lineHeight:1.7, margin:"0 0 24px" }}>
          Free account · No credit card · Takes 60 seconds to sign up.
        </p>

        {[
          { n:"1", text: <>Visit <a href="https://www.alphavantage.co/support/#api-key" target="_blank" rel="noreferrer" style={{ color:"#2563eb" }}>alphavantage.co/support/#api-key</a></> },
          { n:"2", text: <>Fill in your name &amp; email, click <strong>GET FREE API KEY</strong></> },
          { n:"3", text: <>Copy the key shown on screen and paste it below</> },
        ].map(({ n, text }) => (
          <div key={n} style={{ display:"flex", gap:12, marginBottom:10, alignItems:"flex-start" }}>
            <span style={{
              width:22, height:22, borderRadius:"50%", background:"#eff6ff",
              color:"#2563eb", fontSize:11, fontWeight:700,
              display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:1
            }}>{n}</span>
            <span style={{ fontSize:11, color:"#334155", lineHeight:1.7 }}>{text}</span>
          </div>
        ))}

        <div style={{
          background:"#f0fdf4", border:"1px solid #bbf7d0", borderRadius:8,
          padding:"10px 14px", marginBottom:20, marginTop:6,
          fontSize:10, color:"#166534", lineHeight:1.7
        }}>
          ℹ The free tier allows <strong>25 requests per day</strong> and <strong>5 per minute</strong>.
          Loading all 14 ETFs takes about <strong>3 minutes</strong> — lines will appear one by one as data loads.
        </div>

        <input
          type="text"
          value={key}
          onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === "Enter" && key.trim() && onSubmit(key.trim())}
          placeholder="Paste your API key here…"
          style={{
            width:"100%", padding:"10px 14px", borderRadius:8,
            border:"1.5px solid #e2e8f0", fontSize:12,
            fontFamily:"inherit", color:"#0f172a", outline:"none",
            boxSizing:"border-box", marginBottom:10,
          }}
        />
        <button
          onClick={() => key.trim() && onSubmit(key.trim())}
          disabled={!key.trim()}
          style={{
            width:"100%", padding:"11px 0", borderRadius:8,
            background: key.trim() ? "#2563eb" : "#e2e8f0",
            color: key.trim() ? "#fff" : "#94a3b8",
            border:"none", cursor: key.trim() ? "pointer" : "default",
            fontFamily:"inherit", fontSize:12, fontWeight:700, letterSpacing:1,
          }}
        >LOAD DASHBOARD →</button>
        <p style={{ fontSize:9, color:"#cbd5e1", marginTop:12, lineHeight:1.7 }}>
          Your key is only sent to Alpha Vantage and is never stored anywhere.
        </p>
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [apiKey, setApiKey]           = useState("");
  const [activeRange, setActiveRange] = useState("1Y");
  const [selectedGroups, setSelectedGroups] = useState(new Set(Object.keys(GROUPS)));
  const [hiddenTickers, setHiddenTickers]   = useState(new Set());
  const [rawData, setRawData]         = useState({});        // symbol -> rows
  const [loadedSet, setLoadedSet]     = useState(new Set()); // symbols with data
  const [currentSymbol, setCurrentSymbol] = useState(null);  // symbol being fetched right now
  const [progress, setProgress]       = useState(0);
  const [globalError, setGlobalError] = useState(null);
  const [tickerErrors, setTickerErrors] = useState({});
  const [done, setDone]               = useState(false);
  const [countdown, setCountdown]     = useState(0);

  const symbols = ALL_TICKERS.map(t => t.symbol);

  const fetchAll = useCallback(async (key) => {
    setGlobalError(null);
    setTickerErrors({});
    setRawData({});
    setLoadedSet(new Set());
    setProgress(0);
    setDone(false);

    for (let i = 0; i < symbols.length; i++) {
      const symbol = symbols[i];
      setCurrentSymbol(symbol);

      // Countdown timer between requests
      if (i > 0) {
        for (let s = Math.ceil(DELAY_MS / 1000); s > 0; s--) {
          setCountdown(s);
          await sleep(1000);
        }
        setCountdown(0);
      }

      try {
        const data = await fetchTicker(symbol, key);
        setRawData(prev => ({ ...prev, [symbol]: data }));
        setLoadedSet(prev => new Set([...prev, symbol]));
      } catch (e) {
        const msg = e.message || "";
        if (msg.startsWith("invalid_key")) {
          setGlobalError("Invalid API key — please double-check and try again. Message: " + msg.replace("invalid_key: ",""));
          setCurrentSymbol(null);
          return;
        } else if (msg === "rate_limit") {
          // Wait extra 60s and retry once
          setGlobalError("Rate limit hit — waiting 60 seconds then retrying…");
          for (let s = 60; s > 0; s--) { setCountdown(s); await sleep(1000); }
          setCountdown(0);
          setGlobalError(null);
          try {
            const data = await fetchTicker(symbol, key);
            setRawData(prev => ({ ...prev, [symbol]: data }));
            setLoadedSet(prev => new Set([...prev, symbol]));
          } catch {
            setTickerErrors(prev => ({ ...prev, [symbol]: "Failed after retry" }));
          }
        } else {
          setTickerErrors(prev => ({ ...prev, [symbol]: msg }));
        }
      }

      setProgress(Math.round(((i + 1) / symbols.length) * 100));
    }

    setCurrentSymbol(null);
    setDone(true);
  }, []);

  const handleKeySubmit = (key) => {
    setApiKey(key);
    fetchAll(key);
  };

  const rangeMonths = TIME_RANGES.find(r => r.label === activeRange)?.months ?? 12;
  const chartData = mergeAndNormalise(rawData, symbols, rangeMonths);

  const activeTickers = ALL_TICKERS.filter(t => {
    const group = Object.entries(GROUPS).find(([,g]) => g.tickers.includes(t))?.[0];
    return selectedGroups.has(group) && !hiddenTickers.has(t.symbol) && loadedSet.has(t.symbol);
  });

  const toggleGroup = g => setSelectedGroups(prev => {
    const next = new Set(prev);
    next.has(g) ? next.delete(g) : next.add(g);
    return next;
  });

  const toggleTicker = sym => setHiddenTickers(prev => {
    const next = new Set(prev);
    next.has(sym) ? next.delete(sym) : next.add(sym);
    return next;
  });

  const perfMap = {};
  activeTickers.forEach(t => {
    const last = chartData[chartData.length - 1]?.[t.symbol];
    if (last != null) perfMap[t.symbol] = (last - 100).toFixed(1);
  });

  const isLoading = !!currentSymbol;
  const failedTickers = ALL_TICKERS.filter(t => tickerErrors[t.symbol]);

  if (!apiKey) return <SetupScreen onSubmit={handleKeySubmit} />;

  return (
    <div style={{
      minHeight:"100vh", background:"#f8fafc", color:"#1e293b",
      fontFamily:"'IBM Plex Mono','Courier New',monospace",
      display:"flex", flexDirection:"column",
    }}>
      {/* ── HEADER ── */}
      <div style={{
        padding:"20px 28px 0", background:"#fff",
        borderBottom:"1px solid #e2e8f0", boxShadow:"0 1px 4px rgba(0,0,0,0.06)"
      }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", flexWrap:"wrap", gap:12 }}>
          <div>
            <div style={{ fontSize:9, letterSpacing:4, color:"#2563eb", textTransform:"uppercase", marginBottom:4 }}>
              AI Infrastructure · Picks &amp; Shovels
            </div>
            <h1 style={{ margin:0, fontSize:22, fontWeight:700, color:"#0f172a" }}>
              ETF Performance Tracker
            </h1>
            <p style={{ margin:"3px 0 0", fontSize:10, color:"#94a3b8", letterSpacing:1 }}>
              {isLoading
                ? <span style={{ color:"#2563eb" }}>
                    LOADING {currentSymbol}…{countdown > 0 && ` (next in ${countdown}s)`}
                  </span>
                : done
                  ? <span style={{ color:"#16a34a" }}>✓ ALL DATA LOADED · ALPHA VANTAGE</span>
                  : "ALPHA VANTAGE · REAL MARKET DATA"
              }
            </p>
          </div>

          <div style={{ display:"flex", gap:6, paddingBottom:6, flexWrap:"wrap", alignItems:"center" }}>
            {isLoading && <Spinner />}
            {TIME_RANGES.map(r => (
              <button key={r.label} onClick={() => setActiveRange(r.label)} style={{
                padding:"6px 14px", borderRadius:6, cursor:"pointer",
                fontFamily:"inherit", fontSize:11, letterSpacing:1,
                border: activeRange===r.label ? "1.5px solid #2563eb" : "1.5px solid #e2e8f0",
                background: activeRange===r.label ? "#eff6ff" : "#fff",
                color: activeRange===r.label ? "#1d4ed8" : "#64748b",
                fontWeight: activeRange===r.label ? 700 : 400,
              }}>{r.label}</button>
            ))}
            <button onClick={() => { setApiKey(""); setRawData({}); setLoadedSet(new Set()); setDone(false); }} style={{
              padding:"6px 14px", borderRadius:6, cursor:"pointer",
              fontFamily:"inherit", fontSize:11,
              border:"1.5px solid #fee2e2", background:"#fff5f5", color:"#dc2626",
            }}>⌫ CHANGE KEY</button>
          </div>
        </div>

        {/* Progress bar */}
        {isLoading && (
          <div style={{ marginTop:12, marginBottom:0 }}>
            <div style={{ height:3, background:"#e2e8f0", borderRadius:2, overflow:"hidden" }}>
              <div style={{
                width:`${progress}%`, height:"100%", background:"#2563eb",
                borderRadius:2, transition:"width 0.4s ease"
              }}/>
            </div>
            <div style={{ fontSize:9, color:"#94a3b8", marginTop:4, letterSpacing:1 }}>
              {loadedSet.size} / {symbols.length} ETFs loaded · {progress}%
            </div>
          </div>
        )}
      </div>

      {/* ── BODY ── */}
      <div style={{ display:"flex", flex:1 }}>

        {/* Sidebar */}
        <div style={{
          width:215, borderRight:"1px solid #e2e8f0",
          padding:"16px 0", overflowY:"auto", flexShrink:0, background:"#fff",
        }}>
          {Object.entries(GROUPS).map(([groupName, groupData]) => {
            const isGroupOn = selectedGroups.has(groupName);
            return (
              <div key={groupName} style={{ marginBottom:2 }}>
                <button onClick={() => toggleGroup(groupName)} style={{
                  width:"100%", background: isGroupOn ? `${groupData.color}12` : "transparent",
                  border:"none", textAlign:"left", padding:"8px 18px", cursor:"pointer",
                  display:"flex", alignItems:"center", gap:9,
                  borderLeft:`3px solid ${isGroupOn ? groupData.color : "transparent"}`,
                }}>
                  <span style={{
                    width:8, height:8, borderRadius:2, flexShrink:0,
                    background: isGroupOn ? groupData.color : "#cbd5e1",
                  }}/>
                  <span style={{
                    fontSize:10, letterSpacing:2, textTransform:"uppercase", fontWeight:700,
                    color: isGroupOn ? groupData.color : "#94a3b8",
                  }}>{groupName}</span>
                </button>

                {isGroupOn && groupData.tickers.map(ticker => {
                  const isOn = !hiddenTickers.has(ticker.symbol);
                  const color = getColor(ticker.symbol);
                  const pct = perfMap[ticker.symbol];
                  const isCurrentlyLoading = currentSymbol === ticker.symbol;
                  const isLoaded = loadedSet.has(ticker.symbol);
                  const hasError = !!tickerErrors[ticker.symbol];
                  return (
                    <button key={ticker.symbol} onClick={() => isLoaded && toggleTicker(ticker.symbol)} style={{
                      width:"100%", background: isOn && isLoaded ? `${color}0d` : "transparent",
                      border:"none", textAlign:"left", padding:"5px 18px 5px 36px",
                      cursor: isLoaded ? "pointer" : "default",
                      display:"flex", alignItems:"center", gap:8,
                      borderLeft:`2px solid ${isOn && isLoaded ? color : "transparent"}`,
                    }}>
                      {isCurrentlyLoading
                        ? <Spinner size={8}/>
                        : <span style={{
                            width:6, height:6, borderRadius:"50%", flexShrink:0,
                            background: hasError ? "#fca5a5" : isLoaded ? (isOn ? color : "#cbd5e1") : "#e2e8f0",
                          }}/>
                      }
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <span style={{
                            fontSize:11, fontWeight:700,
                            color: hasError ? "#f87171" : isLoaded ? (isOn ? "#0f172a" : "#94a3b8") : "#cbd5e1",
                          }}>{ticker.symbol}</span>
                          {pct != null && isOn && isLoaded && !hasError && (
                            <span style={{ fontSize:10, fontWeight:700, color: parseFloat(pct)>=0 ? "#16a34a" : "#dc2626" }}>
                              {parseFloat(pct)>=0?"+":""}{pct}%
                            </span>
                          )}
                          {isCurrentlyLoading && <span style={{ fontSize:9, color:"#93c5fd" }}>loading…</span>}
                          {!isLoaded && !isCurrentlyLoading && !hasError && (
                            <span style={{ fontSize:9, color:"#cbd5e1" }}>queued</span>
                          )}
                          {hasError && <span style={{ fontSize:9, color:"#f87171" }}>error</span>}
                        </div>
                        <div style={{ fontSize:9, color: isLoaded ? "#94a3b8" : "#cbd5e1", lineHeight:1.3 }}>
                          {ticker.name}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Chart */}
        <div style={{ flex:1, padding:"22px 28px 16px", minWidth:0, display:"flex", flexDirection:"column" }}>

          {/* Error banners */}
          {globalError && (
            <div style={{
              background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8,
              padding:"10px 14px", marginBottom:14, fontSize:11, color:"#991b1b", lineHeight:1.6
            }}>⚠ {globalError}</div>
          )}
          {failedTickers.length > 0 && (
            <div style={{
              background:"#fff7ed", border:"1px solid #fed7aa", borderRadius:8,
              padding:"8px 14px", marginBottom:12, fontSize:10, color:"#92400e", lineHeight:1.6
            }}>
              ⚠ Failed to load: <strong>{failedTickers.map(t=>t.symbol).join(", ")}</strong>
            </div>
          )}

          {/* Empty — nothing loaded yet */}
          {loadedSet.size === 0 && !globalError ? (
            <div style={{
              flex:1, display:"flex", flexDirection:"column",
              alignItems:"center", justifyContent:"center", gap:16
            }}>
              <Spinner size={36}/>
              <div style={{ textAlign:"center" }}>
                <div style={{ color:"#334155", fontSize:12, letterSpacing:1, marginBottom:6 }}>
                  FETCHING LIVE MARKET DATA
                </div>
                <div style={{ color:"#94a3b8", fontSize:10, marginBottom:4 }}>
                  Loading {symbols.length} ETFs one at a time
                </div>
                <div style={{ color:"#cbd5e1", fontSize:10 }}>
                  Lines will appear in the chart as each ETF loads (~3 min total)
                </div>
                {countdown > 0 && (
                  <div style={{ color:"#93c5fd", fontSize:10, marginTop:8 }}>
                    Next request in {countdown}s…
                  </div>
                )}
              </div>
            </div>
          ) : activeTickers.length === 0 && !isLoading ? (
            <div style={{
              flex:1, display:"flex", alignItems:"center", justifyContent:"center",
              color:"#cbd5e1", fontSize:12, letterSpacing:2
            }}>SELECT A GROUP FROM THE SIDEBAR</div>
          ) : (
            <>
              <div style={{ fontSize:9, color:"#94a3b8", letterSpacing:1.5, marginBottom:10, textAlign:"right" }}>
                INDEXED RETURN · BASE = 100 AT PERIOD START
              </div>

              <div style={{
                background:"#fff", borderRadius:12, border:"1px solid #e2e8f0",
                padding:"16px 12px 12px", boxShadow:"0 1px 6px rgba(0,0,0,0.05)"
              }}>
                <ResponsiveContainer width="100%" height={380}>
                  <LineChart data={chartData} margin={{ top:8, right:16, bottom:0, left:0 }}>
                    <CartesianGrid strokeDasharray="3 5" stroke="#f1f5f9" vertical={false}/>
                    <XAxis
                      dataKey="date"
                      tick={{ fill:"#94a3b8", fontSize:9, fontFamily:"IBM Plex Mono,monospace" }}
                      tickLine={false} axisLine={{ stroke:"#e2e8f0" }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fill:"#94a3b8", fontSize:9, fontFamily:"IBM Plex Mono,monospace" }}
                      tickLine={false} axisLine={false} width={36} domain={["auto","auto"]}
                    />
                    <Tooltip content={<CustomTooltip/>}/>
                    {activeTickers.map(t => (
                      <Line
                        key={t.symbol} type="monotone" dataKey={t.symbol}
                        stroke={getColor(t.symbol)} strokeWidth={2}
                        dot={false} activeDot={{ r:4, strokeWidth:0 }} connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Legend */}
              <div style={{
                display:"flex", flexWrap:"wrap", gap:"8px 20px",
                marginTop:14, padding:"12px 16px",
                background:"#fff", borderRadius:10, border:"1px solid #e2e8f0",
              }}>
                {activeTickers.map(t => {
                  const color = getColor(t.symbol);
                  const pct = perfMap[t.symbol];
                  return (
                    <div key={t.symbol} onClick={() => toggleTicker(t.symbol)}
                      style={{ display:"flex", alignItems:"center", gap:7, cursor:"pointer" }}>
                      <div style={{ width:20, height:3, background:color, borderRadius:2 }}/>
                      <span style={{ fontSize:11, color:"#334155", fontWeight:600 }}>{t.symbol}</span>
                      {pct != null && (
                        <span style={{ fontSize:10, fontWeight:700, color: parseFloat(pct)>=0 ? "#16a34a" : "#dc2626" }}>
                          {parseFloat(pct)>=0?"+":""}{pct}%
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <p style={{
            margin:"14px 0 0", fontSize:9, color:"#94a3b8",
            lineHeight:1.7, borderTop:"1px solid #e2e8f0", paddingTop:10,
          }}>
            ⚠ Data sourced from Alpha Vantage for informational purposes only. Not financial advice.
            Past performance does not guarantee future results. Consult a qualified financial advisor.
          </p>
        </div>
      </div>
    </div>
  );
}