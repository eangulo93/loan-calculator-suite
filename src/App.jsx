import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Analytics } from "@vercel/analytics/react";

// ─── ADSENSE AD UNIT ─────────────────────────────────────────────────────────
// Replace ca-pub-XXXXXXXXXXXXXXXX with your real publisher ID after AdSense approval
const ADSENSE_PUBLISHER_ID = "ca-pub-9247721766299360";

function AdUnit({ slot, style = {} }) {
  const adRef = useRef(null);
  const pushed = useRef(false);
  useEffect(() => {
    if (pushed.current) return;
    try {
      if (adRef.current && adRef.current.offsetWidth > 0) {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
        pushed.current = true;
      }
    } catch (e) {}
  }, []);
  if (ADSENSE_PUBLISHER_ID === "ca-pub-9247721766299360") {
    return (
      <div style={{ minHeight: "90px", background: "#f5f8fc", border: "1px dashed #c5d0de", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", margin: "0.75rem 0", ...style }}>
        <span style={{ fontSize: "0.65rem", color: "#9ba8b5" }}>Ad — add your AdSense publisher ID to activate</span>
      </div>
    );
  }
  return (
    <div ref={adRef} style={{ minHeight: "90px", margin: "0.75rem 0", textAlign: "center", ...style }}>
      <ins className="adsbygoogle" style={{ display: "block" }} data-ad-client={ADSENSE_PUBLISHER_ID} data-ad-slot={slot} data-ad-format="auto" data-full-width-responsive="true" />
    </div>
  );
}

// ─── MATH CORE ───────────────────────────────────────────────────────────────
const calcMP = (P, annualRate, months) => {
  if (P <= 0 || months <= 0) return 0;
  const r = annualRate / 100 / 12;
  if (r === 0) return P / months;
  return (P * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
};
const calcTotalInterest = (P, apr, months) => {
  const m = calcMP(P, apr, months);
  return Math.max(0, m * months - P);
};
const solveRate = (P, pmt, months) => {
  // Binary search for monthly rate
  if (pmt <= 0 || P <= 0 || months <= 0) return 0;
  if (pmt * months <= P) return 0;
  let lo = 0.000001, hi = 5;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    const r = mid / 12;
    const calc = r === 0 ? P / months : (P * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1);
    calc > pmt ? (hi = mid) : (lo = mid);
  }
  return ((lo + hi) / 2);
};
const buildAmort = (P, annualRate, months, extraMonthly = 0, extraOnce = 0, extraOnceMonth = 1) => {
  const r = annualRate / 100 / 12;
  const basePmt = calcMP(P, annualRate, months);
  let bal = P, rows = [], cumInt = 0, cumPrin = 0;
  if (extraOnce > 0 && extraOnceMonth <= 1) bal = Math.max(0, bal - extraOnce);
  for (let i = 1; i <= months; i++) {
    if (bal <= 0.005) break;
    const intPart = bal * r;
    const extra = extraMonthly;
    let prinPart = Math.min(basePmt - intPart + extra, bal);
    if (extraOnce > 0 && i === extraOnceMonth && extraOnceMonth > 1) {
      bal = Math.max(0, bal - extraOnce);
    }
    bal = Math.max(0, bal - prinPart);
    cumInt += intPart; cumPrin += prinPart;
    rows.push({ month: i, payment: basePmt + extra, interest: intPart, principal: prinPart, balance: bal, cumInt, cumPrin });
  }
  return rows;
};

// ─── FORMATTERS ─────────────────────────────────────────────────────────────
const $  = (n, d = 0) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: d, maximumFractionDigits: d }).format(n || 0);
const $2 = (n) => $(n, 2);
const pc = (n, d = 2) => (+n || 0).toFixed(d) + "%";
const parseNum = (v) => parseFloat(String(v).replace(/[$,%]/g, "").replace(/,/g, "")) || 0;

// ─── DTI QUALIFYING LIMITS BY LOAN TYPE ─────────────────────────────────────
// fe = max front-end (housing/income), be = max back-end (all debt/income)
// Based on: Fannie Mae SEL-2022-01, HUD 4000.1, VA Lenders Handbook, USDA HB-1-3555
const DTI_RULES = {
  fixed:    { fe: 0.45, be: 0.50, label: "Conventional",    src: "Fannie Mae: 45% standard; up to 50% with DU automated approval" },
  fha:      { fe: 0.31, be: 0.57, label: "FHA",             src: "HUD 4000.1: 31% front-end; up to 57% back-end with compensating factors (strong credit, reserves)" },
  va:       { fe: null, be: 0.41, label: "VA",              src: "VA Lenders Handbook: no front-end cap; 41% back-end guideline (can exceed with residual income)" },
  usda:     { fe: 0.29, be: 0.41, label: "USDA",            src: "USDA HB-1-3555: 29% front-end / 41% back-end; up to 44% back-end with GUS Accept" },
  jumbo:    { fe: 0.43, be: 0.45, label: "Jumbo",           src: "Varies by lender: typically 43–45%. Some lenders allow 50% with substantial assets." },
  arm:      { fe: 0.45, be: 0.50, label: "ARM/Conventional",src: "Fannie Mae: 45% standard; up to 50% with DU automated approval" },
  io:       { fe: 0.43, be: 0.45, label: "Interest-Only",   src: "Typically 43–45%. IO loans face stricter scrutiny; lender overlays common." },
  balloon:  { fe: 0.45, be: 0.50, label: "Balloon",         src: "Treated as conventional: 45% standard; up to 50% with DU" },
  construct: { fe: 0.45, be: 0.50, label: "Construction",   src: "Typically same as conventional: 45–50% depending on lender" },
  heloc:    { fe: 0.43, be: 0.43, label: "HELOC",           src: "Most lenders: 43% combined DTI. Some allow 45–50% with strong credit." },
  heloan:   { fe: 0.43, be: 0.43, label: "Home Equity Loan",src: "Most lenders: 43% combined DTI. Some allow 45–50% with strong credit." },
  cashout:  { fe: 0.45, be: 0.50, label: "Cash-Out Refi",   src: "Fannie Mae: 45% standard; up to 50% with DU automated approval" },
  dscr:     { fe: null, be: null, label: "DSCR",             src: "No personal DTI requirement — qualification based solely on property rental income vs PITIA" },
  hard:     { fe: null, be: null, label: "Hard Money",       src: "Asset-based lending — personal DTI generally not used. Qualification based on property value and exit strategy." },
  bridge:   { fe: null, be: null, label: "Bridge Loan",      src: "Asset-based — DTI flexible. Lender focuses on exit strategy (sale or refi) rather than income." },
  nonqm:    { fe: 0.50, be: 0.55, label: "Non-QM / Bank Stmt", src: "Varies by lender: typically 50–55% back-end. Higher allowed due to non-traditional income documentation." },
  reverse:  { fe: null, be: null, label: "Reverse (HECM)",   src: "No income or DTI requirement. Must pass financial assessment (meet basic property costs). Age 62+ required." },
};
const MARKET_RATES = {
  updated: "May 17, 2026",
  source: "Freddie Mac PMMS + Bankrate + MND",
  rates: [
    { label: "30yr Fixed", rate: 6.36, change: -0.01, src: "Freddie Mac PMMS" },
    { label: "15yr Fixed", rate: 5.71, change: -0.01, src: "Freddie Mac PMMS" },
    { label: "30yr FHA", rate: 6.19, change: -0.00, src: "Fortune/Optimal Blue" },
    { label: "30yr VA", rate: 5.75, change: +0.16, src: "Veterans United" },
    { label: "30yr USDA", rate: 6.12, change: +0.05, src: "Fortune/Optimal Blue" },
    { label: "30yr Jumbo", rate: 6.55, change: +0.13, src: "Fortune/Optimal Blue" },
    { label: "5/1 ARM", rate: 6.10, change: -0.05, src: "Bankrate est." },
    { label: "7/1 ARM", rate: 6.22, change: -0.03, src: "Bankrate est." },
    { label: "HELOC Prime+", rate: 8.50, change: 0, src: "WSJ Prime + margin" },
    { label: "HE Loan", rate: 8.35, change: 0, src: "Bankrate avg" },
    { label: "DSCR (740/75%)", rate: 6.13, change: 0, src: "Defy/HomeAbroad May 2026" },
    { label: "Hard Money", rate: 11.50, change: 0, src: "Industry avg 10.5–12.5%" },
  ]
};

// ─── ALL LOAN TYPES ─────────────────────────────────────────────────────────
const LOAN_CATEGORIES = [
  {
    category: "Home Purchase",
    color: "#0284c7",
    loans: [
      { id: "conv30", label: "Conventional 30yr", defaultRate: 6.36, term: 30, group: "fixed" },
      { id: "conv20", label: "Conventional 20yr", defaultRate: 6.15, term: 20, group: "fixed" },
      { id: "conv15", label: "Conventional 15yr", defaultRate: 5.71, term: 15, group: "fixed" },
      { id: "conv10", label: "Conventional 10yr", defaultRate: 5.60, term: 10, group: "fixed" },
      { id: "fha30",  label: "FHA 30yr",          defaultRate: 6.19, term: 30, group: "fha"   },
      { id: "fha15",  label: "FHA 15yr",          defaultRate: 5.85, term: 15, group: "fha"   },
      { id: "va30",   label: "VA 30yr",           defaultRate: 5.75, term: 30, group: "va"    },
      { id: "va15",   label: "VA 15yr",           defaultRate: 5.35, term: 15, group: "va"    },
      { id: "usda",   label: "USDA 30yr",         defaultRate: 6.12, term: 30, group: "usda"  },
      { id: "jumbo",  label: "Jumbo 30yr",        defaultRate: 6.55, term: 30, group: "jumbo" },
      { id: "jumbo15",label: "Jumbo 15yr",        defaultRate: 6.20, term: 15, group: "jumbo" },
    ]
  },
  {
    category: "Adjustable Rate",
    color: "#6d28d9",
    loans: [
      { id: "arm51",  label: "5/6 ARM",  defaultRate: 6.10, term: 30, group: "arm", fixedYrs: 5  },
      { id: "arm71",  label: "7/6 ARM",  defaultRate: 6.22, term: 30, group: "arm", fixedYrs: 7  },
      { id: "arm101", label: "10/6 ARM", defaultRate: 6.35, term: 30, group: "arm", fixedYrs: 10 },
    ]
  },
  {
    category: "Home Equity",
    color: "#059669",
    loans: [
      { id: "heloc",    label: "HELOC",              defaultRate: 8.50, term: 10, group: "heloc"  },
      { id: "heloan",   label: "Home Equity Loan",   defaultRate: 8.35, term: 15, group: "heloan" },
      { id: "cashout",  label: "Cash-Out Refi",      defaultRate: 6.69, term: 30, group: "cashout"},
    ]
  },
  {
    category: "Specialty",
    color: "#b45309",
    loans: [
      { id: "io30",      label: "Interest Only",     defaultRate: 6.85, term: 30, group: "io",      ioYrs: 10 },
      { id: "balloon",   label: "Balloon 7yr/30",    defaultRate: 6.40, term: 30, group: "balloon", balloonYrs: 7 },
      { id: "reverse",   label: "Reverse (HECM)",    defaultRate: 6.75, term: 30, group: "reverse"  },
      { id: "construct", label: "Construction",      defaultRate: 7.50, term: 30, group: "construct"},
    ]
  },
  {
    category: "Investment / Non-QM",
    color: "#dc2626",
    loans: [
      { id: "dscr30",    label: "DSCR 30yr",         defaultRate: 7.25, term: 30, group: "dscr" },
      { id: "dscr40io",  label: "DSCR 40yr I/O",     defaultRate: 7.50, term: 40, group: "dscr", ioYrs: 10 },
      { id: "hardmoney", label: "Hard Money",        defaultRate: 11.5, term: 1,  group: "hard" },
      { id: "bridge",    label: "Bridge Loan",       defaultRate: 9.50, term: 2,  group: "bridge"},
      { id: "bankstmt",  label: "Bank Statement",    defaultRate: 7.75, term: 30, group: "nonqm" },
      { id: "stated",    label: "DSCR No-Ratio",     defaultRate: 8.25, term: 30, group: "nonqm" },
    ]
  },
];

const LOAN_MAP = {};
LOAN_CATEGORIES.forEach(cat => cat.loans.forEach(l => { LOAN_MAP[l.id] = { ...l, catColor: cat.color, catLabel: cat.category }; }));

// ─── STYLES ─────────────────────────────────────────────────────────────────
const S = {
  bg: "#f0f4f9",
  surface: "#ffffff",
  card: "#ffffff",
  border: "rgba(0,0,0,0.09)",
  text: "#0f1f35",
  muted: "#5a6e84",
  dim: "#dde4ee",
  accent: "#0284c7",
  green: "#059669",
  gold: "#b45309",
  red: "#dc2626",
  purple: "#6d28d9",
};

// ─── DUAL INPUT (Slider + Text Field) ────────────────────────────────────────
function DualInput({ label, value, min, max, step, onChange, prefix = "", suffix = "", note, badge, integer = false }) {
  const [raw, setRaw] = useState("");
  const [focused, setFocused] = useState(false);

  const displayVal = focused ? raw : (prefix + (integer ? Math.round(value).toLocaleString() : value.toLocaleString("en-US", { minimumFractionDigits: step < 1 ? 3 : 0, maximumFractionDigits: step < 1 ? 3 : 0 })) + suffix);
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));

  const handleFocus = () => { setRaw(String(value)); setFocused(true); };
  const handleBlur = () => {
    setFocused(false);
    const parsed = parseFloat(raw.replace(/,/g, "")) || 0;
    const clamped = Math.min(max, Math.max(min, parsed));
    onChange(clamped);
  };
  const handleKey = (e) => { if (e.key === "Enter") e.target.blur(); };

  return (
    <div style={{ marginBottom: "1.3rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
          <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted }}>{label}</span>
          {badge && <span style={{ fontSize: "0.55rem", padding: "0.1rem 0.4rem", borderRadius: "4px", background: "rgba(248,113,113,0.15)", color: S.red, fontWeight: 700 }}>{badge}</span>}
        </div>
        <input
          type="text"
          value={displayVal}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={handleKey}
          style={{
            width: "130px", background: focused ? "#f0f6ff" : "#f5f8fc",
            border: `1px solid ${focused ? S.accent : "rgba(0,0,0,0.12)"}`,
            borderRadius: "6px", color: S.text, padding: "0.3rem 0.55rem",
            fontFamily: "'DM Mono', monospace", fontSize: "0.88rem", fontWeight: 700,
            textAlign: "right", outline: "none", transition: "all 0.15s",
          }}
        />
      </div>
      {note && <p style={{ fontSize: "0.61rem", color: "#7a8fa8", margin: "0 0 0.35rem", lineHeight: 1.4, fontStyle: "italic" }}>{note}</p>}
      <div style={{ position: "relative", height: "3px", background: "#dde4ee", borderRadius: "2px" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: pct + "%", background: `linear-gradient(90deg,#0ea5e9,#38bdf8)`, borderRadius: "2px", transition: "width 0.06s" }} />
        <input type="range" min={min} max={max} step={step} value={Math.min(max, Math.max(min, value))}
          onChange={e => onChange(+e.target.value)}
          style={{ position: "absolute", top: "50%", transform: "translateY(-50%)", width: "100%", appearance: "none", WebkitAppearance: "none", background: "transparent", cursor: "pointer", height: "20px", margin: 0, padding: 0 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.18rem" }}>
        <span style={{ fontSize: "0.57rem", color: "#b0bfce" }}>{prefix}{min.toLocaleString()}{suffix}</span>
        <span style={{ fontSize: "0.57rem", color: "#b0bfce" }}>{prefix}{max.toLocaleString()}{suffix}</span>
      </div>
    </div>
  );
}

// ─── PILL TOGGLE ─────────────────────────────────────────────────────────────
function Pills({ value, onChange, options, color = S.accent }) {
  return (
    <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
      {options.map(o => (
        <button key={o.v} onClick={() => onChange(o.v)} style={{
          padding: "0.3rem 0.75rem", borderRadius: "20px",
          border: `1px solid ${value === o.v ? color : "rgba(0,0,0,0.1)"}`,
          background: value === o.v ? color + "18" : "#f5f8fc",
          color: value === o.v ? color : S.muted,
          fontSize: "0.71rem", fontWeight: value === o.v ? 700 : 400,
          cursor: "pointer", fontFamily: "inherit", transition: "all 0.11s",
        }}>{o.l}</button>
      ))}
    </div>
  );
}

// ─── CARD / SECTION ──────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return <div style={{ background: S.card, border: `1px solid ${S.border}`, borderRadius: "11px", padding: "1.25rem", ...style }}>{children}</div>;
}
function SectionHead({ label }) {
  return <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: S.muted, marginBottom: "1rem" }}>{label}</div>;
}
function Divider() { return <div style={{ height: "1px", background: S.dim, margin: "0.6rem 0" }} />; }

// ─── STAT BLOCK ─────────────────────────────────────────────────────────────
function Stat({ label, value, sub, color, warn, large }) {
  return (
    <div style={{ background: "#f5f8fc", border: `1px solid ${warn ? "rgba(220,38,38,0.2)" : "rgba(0,0,0,0.07)"}`, borderRadius: "9px", padding: "0.85rem 1rem" }}>
      <div style={{ fontSize: "0.57rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: warn ? S.red : S.muted, marginBottom: "0.3rem" }}>{label}</div>
      <div style={{ fontSize: large ? "1.5rem" : "1.1rem", fontWeight: 900, color: color || S.text, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: "0.61rem", color: S.muted, marginTop: "0.25rem", lineHeight: 1.35 }}>{sub}</div>}
    </div>
  );
}

// ─── DETAIL ROW ──────────────────────────────────────────────────────────────
function Row({ label, value, hi, warn, note, border = true }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "0.42rem 0", borderBottom: border ? `1px solid ${S.dim}` : "none", gap: "1rem" }}>
      <div>
        <span style={{ fontSize: "0.71rem", color: S.muted }}>{label}</span>
        {note && <div style={{ fontSize: "0.59rem", color: "#9ba8b5", marginTop: "0.1rem" }}>{note}</div>}
      </div>
      <span style={{ fontSize: "0.8rem", fontWeight: hi ? 700 : 400, color: warn ? S.red : hi ? S.accent : "#374151", fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

// ─── ALERT ───────────────────────────────────────────────────────────────────
function Alert({ type = "tip", children }) {
  const t = { tip: { bg: "#eff8ff", b: "#bfdbfe", ic: "💡", c: "#1d4ed8" }, warn: { bg: "#fef2f2", b: "#fecaca", ic: "⚠️", c: "#b91c1c" }, good: { bg: "#f0fdf4", b: "#bbf7d0", ic: "✅", c: "#15803d" } }[type];
  return (
    <div style={{ background: t.bg, border: `1px solid ${t.b}`, borderRadius: "8px", padding: "0.7rem 0.9rem", display: "flex", gap: "0.55rem", margin: "0.7rem 0" }}>
      <span style={{ flexShrink: 0, fontSize: "0.82rem" }}>{t.ic}</span>
      <p style={{ margin: 0, fontSize: "0.72rem", color: t.c, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}

// ─── FULL AMORTIZATION TABLE ─────────────────────────────────────────────────
function AmortTable({ schedule, view, setView }) {
  const annualRows = useMemo(() => {
    const yrs = [];
    const totalYrs = Math.ceil(schedule.length / 12);
    for (let y = 1; y <= totalYrs; y++) {
      const chunk = schedule.slice((y - 1) * 12, y * 12);
      if (!chunk.length) break;
      yrs.push({
        year: y,
        totalPaid: chunk.reduce((a, r) => a + r.payment, 0),
        totalInt:  chunk.reduce((a, r) => a + r.interest, 0),
        totalPrin: chunk.reduce((a, r) => a + r.principal, 0),
        balance:   chunk[chunk.length - 1].balance,
        cumInt:    chunk[chunk.length - 1].cumInt,
        cumPrin:   chunk[chunk.length - 1].cumPrin,
      });
    }
    return yrs;
  }, [schedule]);

  const rows = view === "monthly" ? schedule : annualRows;
  const cols = view === "monthly"
    ? ["Month", "Payment", "Principal", "Interest", "Cum. Interest", "Balance"]
    : ["Year",  "Total Paid", "Principal", "Interest", "Cum. Interest", "Balance"];

  return (
    <div>
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.85rem", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: S.muted }}>{schedule.length} payments · {(schedule.length / 12).toFixed(1)} years</span>
        <Pills value={view} onChange={setView} options={[{ v: "annual", l: "Annual" }, { v: "monthly", l: "Monthly" }]} />
      </div>
      <div style={{ overflowX: "auto", maxHeight: "360px", overflowY: "auto", border: `1px solid ${S.border}`, borderRadius: "6px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.69rem", minWidth: "520px" }}>
          <thead style={{ position: "sticky", top: 0, background: "#f5f8fc", zIndex: 1 }}>
            <tr>{cols.map(c => <th key={c} style={{ textAlign: "right", padding: "0.4rem 0.55rem", color: S.muted, fontWeight: 700, fontSize: "0.57rem", letterSpacing: "0.09em", textTransform: "uppercase", borderBottom: `1px solid ${S.border}` }}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "#ffffff" : "#f9fbfd" }}>
                {view === "monthly" ? [
                  <td key="m"  style={td}>{r.month}</td>,
                  <td key="p"  style={tdN}>{$2(r.payment)}</td>,
                  <td key="pr" style={{ ...tdN, color: S.accent }}>{$2(r.principal)}</td>,
                  <td key="i"  style={{ ...tdN, color: S.gold }}>{$2(r.interest)}</td>,
                  <td key="ci" style={{ ...tdN, color: "#5a7898" }}>{$(r.cumInt)}</td>,
                  <td key="b"  style={tdN}>{$(r.balance)}</td>,
                ] : [
                  <td key="y"  style={td}>{r.year}</td>,
                  <td key="tp" style={tdN}>{$(r.totalPaid)}</td>,
                  <td key="pr" style={{ ...tdN, color: S.accent }}>{$(r.totalPrin)}</td>,
                  <td key="i"  style={{ ...tdN, color: S.gold }}>{$(r.totalInt)}</td>,
                  <td key="ci" style={{ ...tdN, color: "#5a7898" }}>{$(r.cumInt)}</td>,
                  <td key="b"  style={tdN}>{$(r.balance)}</td>,
                ]}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
const td  = { padding: "0.32rem 0.55rem", color: "#6b7a8f", fontFamily: "'DM Mono', monospace", textAlign: "right" };
const tdN = { padding: "0.32rem 0.55rem", color: "#374151", fontFamily: "'DM Mono', monospace", textAlign: "right" };

// ─── EQUITY METER ─────────────────────────────────────────────────────────────
function EquityMeter({ equity, homeValue }) {
  const pct = Math.min(100, Math.max(0, (equity / homeValue) * 100));
  return (
    <div style={{ marginBottom: "0.75rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.62rem", color: S.muted, marginBottom: "0.3rem" }}>
        <span>0% equity</span><span>50%</span><span>100%</span>
      </div>
      <div style={{ height: "12px", borderRadius: "6px", background: "#dde4ee", overflow: "hidden" }}>
        <div style={{ height: "100%", width: pct + "%", background: `linear-gradient(90deg, #0ea5e9, #34d399)`, borderRadius: "6px", transition: "width 0.4s" }} />
      </div>
      <div style={{ textAlign: "right", fontSize: "0.62rem", color: S.muted, marginTop: "0.2rem" }}>{pct.toFixed(1)}% equity owned</div>
    </div>
  );
}

// ─── PAYMENT PRINCIPAL CHART ─────────────────────────────────────────────────
function PrinIntBar({ principal, interest, pmi = 0, tax = 0, ins = 0, hoa = 0 }) {
  const total = principal + interest + pmi + tax + ins + hoa;
  const segs = [
    { label: "Principal", val: principal, color: S.accent },
    { label: "Interest",  val: interest,  color: S.gold },
    { label: "Tax",       val: tax,       color: "#a78bfa" },
    { label: "Insurance", val: ins,       color: "#34d399" },
    { label: "PMI",       val: pmi,       color: S.red },
    { label: "HOA",       val: hoa,       color: "#fb923c" },
  ].filter(s => s.val > 0);
  return (
    <div>
      <div style={{ height: "10px", borderRadius: "5px", overflow: "hidden", background: "#dde4ee", display: "flex" }}>
        {segs.map(s => <div key={s.label} title={`${s.label}: ${$2(s.val)}`} style={{ width: (s.val / total * 100) + "%", background: s.color }} />)}
      </div>
      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
        {segs.map(s => (
          <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <div style={{ width: 8, height: 8, borderRadius: "2px", background: s.color, flexShrink: 0 }} />
            <span style={{ fontSize: "0.63rem", color: S.muted }}>{s.label} <span style={{ fontFamily: "'DM Mono', monospace", color: "#5a7898" }}>{$2(s.val)}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN CALCULATOR
// ═══════════════════════════════════════════════════════════════════════════
// ─── FRED API CONFIG ────────────────────────────────────────────────────────
const FRED_KEY = "15324c2be136ca5331844402e6a2aa59";
const FRED = (series) => `/api/fred?series=${series}`;
  `https://api.stlouisfed.org/fred/series/observations?series_id=${series}&api_key=${FRED_KEY}&limit=1&sort_order=desc&file_type=json`;

export default function LoanCalcSuite() {
  const [tab, setTab] = useState("rates");
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    const validTabs = ["rates", "calc", "equity", "debtcon", "dscr", "finder"];
    if (validTabs.includes(hash)) setTab(hash);
  }, []);

  // ── Live market rates from FRED ──────────────────────────────────────────
  const [liveRates, setLiveRates]   = useState(null);   // null = loading, {} = loaded
  const [ratesDate, setRatesDate]   = useState(null);
  const [ratesError, setRatesError] = useState(false);

  useEffect(() => {
    const fetchRates = async () => {
      try {
        const [r30, r15, prime] = await Promise.all([
          fetch(FRED("MORTGAGE30US")).then(r => r.json()),
          fetch(FRED("MORTGAGE15US")).then(r => r.json()),
          fetch(FRED("PRIME")).then(r => r.json()),
        ]);
        const rate30  = parseFloat(r30.observations?.[0]?.value  || "6.36");
        const rate15  = parseFloat(r15.observations?.[0]?.value  || "5.71");
        const primeR  = parseFloat(prime.observations?.[0]?.value || "8.50");
        const date30  = r30.observations?.[0]?.date || "";

        // Derive all rates from spreads vs 30yr and Prime
        setLiveRates({
          rate30,
          rate15,
          prime:   primeR,
          fha30:   +(rate30 - 0.17).toFixed(2),
          fha15:   +(rate15 - 0.10).toFixed(2),
          va30:    +(rate30 - 0.61).toFixed(2),
          va15:    +(rate15 - 0.36).toFixed(2),
          usda:    +(rate30 - 0.24).toFixed(2),
          jumbo30: +(rate30 + 0.19).toFixed(2),
          jumbo15: +(rate15 + 0.19).toFixed(2),
          arm51:   +(rate30 - 0.26).toFixed(2),
          arm71:   +(rate30 - 0.14).toFixed(2),
          arm101:  +(rate30 - 0.01).toFixed(2),
          heloc:   +(primeR + 0.50).toFixed(2),
          heloan:  +(primeR + 0.35).toFixed(2),
          cashout: +(rate30 + 0.33).toFixed(2),
        });
        setRatesDate(date30);
      } catch (e) {
        setRatesError(true);
      }
    };
    fetchRates();
  }, []);

  // Loan type
  const [loanId, setLoanId] = useState("conv30");
  const loan = LOAN_MAP[loanId];

  // Core inputs
  const [homePrice,  setHomePrice]  = useState(425000);
  const [downPct,    setDownPct]    = useState(20);
  const [rate,       setRate]       = useState(loan.defaultRate);
  const [termYrs,    setTermYrs]    = useState(loan.term);
  const [propTax,    setPropTax]    = useState(1.1);
  const [insurance,  setInsurance]  = useState(175);
  const [hoa,        setHoa]        = useState(0);
  const [appreciation, setAppreciation] = useState(3.5);

  // Extra payments
  const [extraMo,    setExtraMo]    = useState(0);
  const [extraOnce,  setExtraOnce]  = useState(0);
  const [extraMonth, setExtraMonth] = useState(1);

  // ARM
  const [armAdj,     setArmAdj]     = useState(1.5);
  const [armCap,     setArmCap]     = useState(5.0);

  // Equity tab
  const [eqHomeVal,  setEqHomeVal]  = useState(450000);
  const [eqMortBal,  setEqMortBal]  = useState(280000);
  const [eqOtherLiens, setEqOtherLiens] = useState(0);
  const [eqBorrow,   setEqBorrow]   = useState(50000);
  const [eqRate,     setEqRate]     = useState(8.35);
  const [eqTerm,     setEqTerm]     = useState(15);
  const [eqType,     setEqType]     = useState("heloan");

  // Cash-out refi specific
  const [coCashWanted,      setCoCashWanted]      = useState(60000);
  const [coNewRate,         setCoNewRate]         = useState(6.69);
  const [coNewTerm,         setCoNewTerm]         = useState(30);
  const [coCurrentRate,     setCoCurrentRate]     = useState(3.25);
  const [coCurrentRemMo,    setCoCurrentRemMo]    = useState(312);
  const [coClosingPct,      setCoClosingPct]      = useState(2.5);
  const [coRollClosing,     setCoRollClosing]     = useState(true);
  const [coKnowPayment,     setCoKnowPayment]     = useState(false);   // toggle: enter actual payment?
  const [coActualPmt,       setCoActualPmt]       = useState(1450);    // what they actually pay monthly
  const [coEscrowIncluded,  setCoEscrowIncluded]  = useState(false);   // does that payment include T&I?
  const [coMonthlyTax,      setCoMonthlyTax]      = useState(350);     // monthly tax portion (if escrow)
  const [coMonthlyIns,      setCoMonthlyIns]      = useState(150);     // monthly insurance portion (if escrow)

  // Free & Clear
  const [fcHomeVal,  setFcHomeVal]  = useState(400000);
  const [fcLoanAmt,  setFcLoanAmt]  = useState(80000);
  const [fcRate,     setFcRate]     = useState(8.35);
  const [fcTerm,     setFcTerm]     = useState(15);
  const [fcLoanType, setFcLoanType] = useState("heloan"); // heloan | heloc | firstmort

  // Debt Consolidation
  const [dcHomeVal,  setDcHomeVal]  = useState(420000);
  const [dcMortBal,  setDcMortBal]  = useState(210000);
  const [dcFreeClr,     setDcFreeClr]     = useState(false);  // owns free & clear
  const [dcMortPmt,     setDcMortPmt]     = useState(1650);   // actual current mortgage payment
  const [dcMortEscrow,  setDcMortEscrow]  = useState(false);  // payment includes T&I escrow
  const [dcMortTax,     setDcMortTax]     = useState(350);    // monthly tax in escrow
  const [dcMortIns,     setDcMortIns]     = useState(150);    // monthly insurance in escrow
  const [dcNewRate,     setDcNewRate]     = useState(6.69);
  const [dcNewTerm,     setDcNewTerm]     = useState(30);
  const [dcClosPct,     setDcClosPct]     = useState(2.5);
  const [dcRollClos,    setDcRollClos]    = useState(true);
  const [dcDebts, setDcDebts] = useState([
    { id: 1, name: "Credit Card 1",   balance: 8500,  rate: 22.99, monthly: 250 },
    { id: 2, name: "Credit Card 2",   balance: 5200,  rate: 19.99, monthly: 150 },
    { id: 3, name: "Auto Loan",       balance: 18000, rate: 7.49,  monthly: 410 },
    { id: 4, name: "Personal Loan",   balance: 12000, rate: 14.99, monthly: 320 },
  ]);
  const [dcNextId, setDcNextId] = useState(5);
  const [dscrPurchase, setDscrPurchase] = useState(350000);
  const [dscrDown,     setDscrDown]     = useState(25);
  const [dscrRate,     setDscrRate]     = useState(7.25);
  const [dscrRent,     setDscrRent]     = useState(2400);
  const [dscrTax,      setDscrTax]      = useState(350);
  const [dscrIns,      setDscrIns]      = useState(120);
  const [dscrHOA,      setDscrHOA]      = useState(0);
  const [dscrVacancy,  setDscrVacancy]  = useState(5);
  const [dscrMgmt,     setDscrMgmt]     = useState(8);

  // Rate finder
  const [rfLoan,      setRfLoan]      = useState(300000);
  const [rfPayment,   setRfPayment]   = useState(1450);   // P&I only
  const [rfTotalPmt,  setRfTotalPmt]  = useState(1950);   // total payment inc. T&I
  const [rfTerm,      setRfTerm]      = useState(30);
  const [rfKnow,      setRfKnow]      = useState("payment");
  const [rfHomeVal,   setRfHomeVal]   = useState(375000);
  const [rfTax,       setRfTax]       = useState(350);
  const [rfIns,       setRfIns]       = useState(150);
  const [rfHOA,       setRfHOA]       = useState(0);
  const [rfShowTax,   setRfShowTax]   = useState(false);

  // UI
  const [amortView,  setAmortView]  = useState("annual");
  const [showAmort,  setShowAmort]  = useState(false);
  const [showExtras, setShowExtras] = useState(false);

  // Sync rate/term when loan type changes
  useEffect(() => {
    setRate(LOAN_MAP[loanId].defaultRate);
    setTermYrs(LOAN_MAP[loanId].term);
  }, [loanId]);

  // ── Core calcs ──────────────────────────────────────────────────────────
  const down      = homePrice * downPct / 100;
  const fhaUp     = loan.group === "fha" ? (homePrice - down) * 0.0175 : 0;
  const vaFee     = loan.group === "va"  ? (homePrice - down) * (downPct >= 10 ? 0.014 : 0.0215) : 0;
  const principal = Math.max(0, homePrice - down + fhaUp + vaFee);
  const months    = termYrs * 12;

  const basePmt   = calcMP(principal, rate, months);
  const baseInt   = calcTotalInterest(principal, rate, months);
  const monthlyTax = (homePrice * propTax / 100) / 12;
  const pmi       = loan.group === "conv" && downPct < 20 ? principal * 0.0085 / 12 : 0;
  const fhaMIP    = loan.group === "fha"  ? principal * 0.0055 / 12 : 0;
  const ltv       = homePrice > 0 ? principal / homePrice : 0;

  const isIO      = loan.group === "io" || (loan.group === "dscr" && loan.ioYrs);
  const ioPmt     = isIO ? principal * rate / 100 / 12 : 0;
  const displayPmt = isIO ? ioPmt : basePmt;

  const totalPITI = displayPmt + (pmi || 0) + (fhaMIP || 0) + monthlyTax + insurance + hoa;

  // Prepayment
  const schedule  = useMemo(() => buildAmort(principal, rate, months, extraMo, extraOnce, extraMonth), [principal, rate, months, extraMo, extraOnce, extraMonth]);
  const schedBase = useMemo(() => buildAmort(principal, rate, months), [principal, rate, months]);
  const moSaved   = schedBase.length - schedule.length;
  const intSaved  = schedBase[schedBase.length - 1]?.cumInt - schedule[schedule.length - 1]?.cumInt;

  // PMI drop
  const pmiDropMonth = useMemo(() => {
    if (!pmi) return null;
    return schedBase.findIndex(r => r.balance <= homePrice * 0.8) + 1 || null;
  }, [schedBase, homePrice, pmi]);

  // Balance at key points
  const bal5  = schedBase[Math.min(59, schedBase.length - 1)]?.balance || 0;
  const bal10 = schedBase[Math.min(119, schedBase.length - 1)]?.balance || 0;
  const bal15 = schedBase[Math.min(179, schedBase.length - 1)]?.balance || 0;

  // Equity tab calcs
  const eqEquity      = Math.max(0, eqHomeVal - eqMortBal - eqOtherLiens);
  const eqCurrentLTV  = eqHomeVal > 0 ? eqMortBal / eqHomeVal : 0;
  const eqMaxBorrow85 = Math.max(0, eqHomeVal * 0.85 - eqMortBal - eqOtherLiens);
  const eqMaxBorrow80 = Math.max(0, eqHomeVal * 0.80 - eqMortBal - eqOtherLiens);
  const eqSafe        = Math.min(eqBorrow, eqMaxBorrow85);
  const eqCLTV        = eqHomeVal > 0 ? (eqMortBal + eqOtherLiens + eqSafe) / eqHomeVal : 0;
  const eqMoPmt       = eqType === "heloc" ? (eqSafe * eqRate / 100) / 12 : calcMP(eqSafe, eqRate, eqTerm * 12);
  const eqTotInt      = eqType === "heloc" ? eqMoPmt * eqTerm * 12 : calcTotalInterest(eqSafe, eqRate, eqTerm * 12);
  const eqAmort       = useMemo(() => eqType !== "heloc" ? buildAmort(eqSafe, eqRate, eqTerm * 12) : [], [eqSafe, eqRate, eqTerm, eqType]);

  // Cash-out refi calcs
  const coEquity         = Math.max(0, eqHomeVal - eqMortBal);
  const coMaxCash80      = Math.max(0, eqHomeVal * 0.80 - eqMortBal);
  const coMaxCash85      = Math.max(0, eqHomeVal * 0.85 - eqMortBal);
  const coSafeCash       = Math.min(coCashWanted, coMaxCash80);
  const coClosingDollars = (eqMortBal + coSafeCash) * coClosingPct / 100;
  const coNewLoan        = eqMortBal + coSafeCash + (coRollClosing ? coClosingDollars : 0);
  const coCashAtClose    = coSafeCash - (coRollClosing ? 0 : coClosingDollars);
  const coNewLTV         = eqHomeVal > 0 ? coNewLoan / eqHomeVal : 0;
  const coNewPmt         = calcMP(coNewLoan, coNewRate, coNewTerm * 12);
  const coNewTotInt      = calcTotalInterest(coNewLoan, coNewRate, coNewTerm * 12);
  const coOldRemInt      = calcTotalInterest(eqMortBal, coCurrentRate, coCurrentRemMo);
  // Current payment: use what they entered OR calculate from rate/balance/term
  const coCalcPmt        = calcMP(eqMortBal, coCurrentRate, coCurrentRemMo);
  const coDisplayPmt     = coKnowPayment ? coActualPmt : coCalcPmt;
  // If escrow included, strip out T&I to get pure P&I for comparison
  const coEscrowAmt      = coEscrowIncluded ? (coMonthlyTax + coMonthlyIns) : 0;
  const coPandI          = coKnowPayment ? Math.max(0, coDisplayPmt - coEscrowAmt) : coCalcPmt;
  // Payment difference compares P&I only (new loan P&I vs current P&I)
  const coPmtDiff        = coNewPmt - coPandI;
  // Full PITI diff (new P&I vs current total payment including any escrow)
  const coFullPmtDiff    = coNewPmt - coDisplayPmt;
  const coBreakevenMo    = coPmtDiff < 0 ? Math.ceil(coClosingDollars / Math.abs(coPmtDiff)) : null;
  const coNewAmort       = useMemo(() => buildAmort(coNewLoan, coNewRate, coNewTerm * 12), [coNewLoan, coNewRate, coNewTerm]);
  const [coShowAmort, setCoShowAmort] = useState(false);

  // Free & Clear calcs
  const fcEquity       = fcHomeVal;
  const fcMax80        = fcHomeVal * 0.80;
  const fcMax70        = fcHomeVal * 0.70; // more conservative for first-position
  const fcSafe         = Math.min(fcLoanAmt, fcMax80);
  const fcLTV          = fcHomeVal > 0 ? fcSafe / fcHomeVal : 0;
  const fcMoPmt        = fcLoanType === "heloc" ? (fcSafe * fcRate / 100) / 12 : calcMP(fcSafe, fcRate, fcTerm * 12);
  const fcTotInt       = fcLoanType === "heloc" ? fcMoPmt * fcTerm * 12 : calcTotalInterest(fcSafe, fcRate, fcTerm * 12);
  const fcAmort        = useMemo(() => fcLoanType !== "heloc" ? buildAmort(fcSafe, fcRate, fcTerm * 12) : [], [fcSafe, fcRate, fcTerm, fcLoanType]);

  // Debt Consolidation calcs
  const dcMortBalance  = dcFreeClr ? 0 : dcMortBal;
  const dcTotalDebtBal = dcDebts.reduce((a, d) => a + d.balance, 0);
  const dcTotalMonthly = dcDebts.reduce((a, d) => a + d.monthly, 0);
  const dcTotalInterest= dcDebts.reduce((a, d) => a + (d.balance * d.rate / 100 / 12), 0);
  const dcWtdAvgRate   = dcTotalDebtBal > 0 ? dcDebts.reduce((a, d) => a + d.rate * d.balance, 0) / dcTotalDebtBal : 0;
  const dcNewLoanBase  = dcMortBalance + dcTotalDebtBal;
  const dcClosing      = dcNewLoanBase * dcClosPct / 100;
  const dcNewLoan      = dcNewLoanBase + (dcRollClos ? dcClosing : 0);
  const dcMaxAvail80   = Math.max(0, dcHomeVal * 0.80 - dcMortBalance);
  const dcMaxAvail85   = Math.max(0, dcHomeVal * 0.85 - dcMortBalance);
  const dcCanAfford    = dcTotalDebtBal <= dcMaxAvail80;
  const dcNewLTV       = dcHomeVal > 0 ? dcNewLoan / dcHomeVal : 0;
  const dcNewPmt       = calcMP(dcNewLoan, dcNewRate, dcNewTerm * 12);
  const dcNewTotInt    = calcTotalInterest(dcNewLoan, dcNewRate, dcNewTerm * 12);
  // Current mortgage payment: use entered value or estimate
  const dcCalcMortPmt   = dcFreeClr ? 0 : calcMP(dcMortBalance, 6.5, 360);
  const dcActualMortPmt = dcFreeClr ? 0 : dcMortPmt;
  const dcMortEscrowAmt = dcMortEscrow ? (dcMortTax + dcMortIns) : 0;
  const dcMortPandI     = dcMortEscrow ? Math.max(0, dcActualMortPmt - dcMortEscrowAmt) : dcActualMortPmt;
  const dcTotalCurrentOut = dcTotalMonthly + dcActualMortPmt;
  const dcMonthlySavings  = dcTotalCurrentOut - dcNewPmt;
  const dcAmort        = useMemo(() => buildAmort(dcNewLoan, dcNewRate, dcNewTerm * 12), [dcNewLoan, dcNewRate, dcNewTerm]);
  const [dcShowAmort, setDcShowAmort] = useState(false);

  const addDebt = () => {
    setDcDebts(prev => [...prev, { id: dcNextId, name: "New Debt", balance: 5000, rate: 18.99, monthly: 150 }]);
    setDcNextId(n => n + 1);
  };
  const removeDebt = (id) => setDcDebts(prev => prev.filter(d => d.id !== id));
  const updateDebt = (id, field, val) => setDcDebts(prev => prev.map(d => d.id === id ? { ...d, [field]: val } : d));

  // DSCR calcs
  const dscrLoan      = dscrPurchase * (1 - dscrDown / 100);
  const dscrMoPmt     = calcMP(dscrLoan, dscrRate, 30 * 12);
  const dscrPITIA     = dscrMoPmt + dscrTax + dscrIns + dscrHOA;
  const dscrGrossRent = dscrRent;
  const dscrEffRent   = dscrRent * (1 - dscrVacancy / 100);
  const dscrMgmtCost  = dscrEffRent * dscrMgmt / 100;
  const dscrNetIncome = dscrEffRent - dscrMgmtCost;
  const dscrRatio     = dscrPITIA > 0 ? dscrNetIncome / dscrPITIA : 0;
  const dscrCashflow  = dscrNetIncome - dscrPITIA;
  const dscrAmort     = useMemo(() => buildAmort(dscrLoan, dscrRate, 30 * 12), [dscrLoan, dscrRate]);

  // Rate finder
  // Rate Finder calcs — always derive P&I first, then find rate
  const rfExtractedPI  = rfShowTax
    ? Math.max(1, rfTotalPmt - rfTax - rfIns - rfHOA)
    : rfPayment;
  const foundRate = useMemo(() => {
    return solveRate(rfLoan, rfExtractedPI, rfTerm * 12);
  }, [rfLoan, rfExtractedPI, rfTerm]);
  const rfMonthlyNeeded = calcMP(rfLoan, foundRate, rfTerm * 12);
  // PITI extras
  const rfLTV          = rfHomeVal > 0 ? rfLoan / rfHomeVal : 0;
  const rfPMI          = rfLTV > 0.8 && rfLTV < 1 ? (rfLoan * 0.0085) / 12 : 0;
  const rfPMIDropMonth = useMemo(() => {
    if (rfPMI === 0 || foundRate === 0) return null;
    const sched = buildAmort(rfLoan, foundRate * 100, rfTerm * 12);
    const idx = sched.findIndex(r => r.balance <= rfHomeVal * 0.8);
    return idx >= 0 ? idx + 1 : null;
  }, [rfLoan, foundRate, rfTerm, rfHomeVal, rfPMI]);
  // Total PITI — always use extracted P&I so tax/insurance are never double-counted
  const rfTotalPITI    = rfExtractedPI + rfTax + rfIns + rfHOA + rfPMI;

  // ── CSS inject ──────────────────────────────────────────────────────────
  useEffect(() => {
    const s = document.createElement("style");
    s.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,700;0,800;1,400&family=DM+Mono:wght@400;500;700&display=swap');
      * { box-sizing:border-box; }
      input[type=range]{-webkit-appearance:none;appearance:none;}
      input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;background:#fff;border:2px solid #0284c7;cursor:pointer;box-shadow:0 0 0 3px rgba(2,132,199,.15);}
      input[type=range]::-moz-range-thumb{width:15px;height:15px;border-radius:50%;background:#fff;border:2px solid #0284c7;cursor:pointer;}
      ::-webkit-scrollbar{width:5px;height:5px;}
      ::-webkit-scrollbar-track{background:#f0f4f9;}
      ::-webkit-scrollbar-thumb{background:#c5d0de;border-radius:3px;}
      ::selection{background:rgba(2,132,199,.15);}
    `;
    document.head.appendChild(s);
    return () => document.head.removeChild(s);
  }, []);

  const TABS = [
    { id: "rates",   label: "📊 Market Rates" },
    { id: "calc",    label: "🏠 Mortgage Loan Calculator" },
    { id: "equity",  label: "🏦 Equity Calculator" },
    { id: "debtcon", label: "💳 Debt Consolidation" },
    { id: "dscr",    label: "📈 DSCR / Investor" },
    { id: "finder",  label: "🔍 Rate Finder" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: S.bg, fontFamily: "'DM Sans', sans-serif", color: S.text }}>

   {/* ── HEADER ── */}
      <div style={{ background: "#ffffff", borderBottom: `1px solid rgba(0,0,0,0.09)`, padding: "1rem 1.5rem", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.25rem" }}>
              <span style={{ fontSize: "1.1rem" }}>💰</span>
              <h1 style={{ fontFamily: "'DM Sans',sans-serif", fontSize: "clamp(1.1rem,2.5vw,1.5rem)", fontWeight: 800, margin: 0, letterSpacing: "-0.02em" }}>
                My Loan Breakdown
              </h1>
              <span style={{ fontSize: "0.58rem", background: "#e0f2fe", color: "#0284c7", border: "1px solid #bae6fd", borderRadius: "4px", padding: "0.1rem 0.45rem", fontWeight: 700 }}>LIVE RATES</span>
            </div>
            <p style={{ margin: 0, fontSize: "0.72rem", color: S.muted }}>All loan types · Typed inputs · Full amortization · Live rates · DSCR · Equity · Rate finder</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
            <a href="/about.html"   style={{ fontSize: "0.73rem", color: S.muted, textDecoration: "none", fontWeight: 500 }}>About</a>
            <a href="/privacy.html" style={{ fontSize: "0.73rem", color: S.muted, textDecoration: "none", fontWeight: 500 }}>Privacy</a>
            <a href="/terms.html"   style={{ fontSize: "0.73rem", color: S.muted, textDecoration: "none", fontWeight: 500 }}>Terms</a>
            <a href="/apply.html" style={{ display: "inline-block", padding: "0.45rem 1.1rem", background: "linear-gradient(135deg,#0284c7,#0ea5e9)", color: "#fff", borderRadius: "7px", textDecoration: "none", fontSize: "0.78rem", fontWeight: 700 }}>Apply for a Loan →</a>
          </div>
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{ background: "#ffffff", borderBottom: `1px solid rgba(0,0,0,0.09)`, overflowX: "auto" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", padding: "0 1rem" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "0.8rem 1rem", background: "transparent", border: "none",
              borderBottom: `2px solid ${tab === t.id ? S.accent : "transparent"}`,
              color: tab === t.id ? S.accent : S.muted,
              fontWeight: tab === t.id ? 700 : 400, fontSize: "0.72rem",
              cursor: "pointer", whiteSpace: "nowrap", fontFamily: "inherit",
              transition: "all 0.12s",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Top Banner Ad */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0.5rem 1rem 0" }}>
        <AdUnit slot="ca-pub-9247721766299360" />
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "1.25rem 1rem 4rem" }}>

        {/* ══════════════════════════════════════════════════════════════════
            TAB: MARKET RATES
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "rates" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.5rem" }}>
              <div>
                <h2 style={{ margin: "0 0 0.2rem", fontSize: "1.1rem", fontWeight: 800 }}>Current Market Rates</h2>
                <p style={{ margin: 0, fontSize: "0.68rem", color: S.muted }}>
                  {liveRates
                    ? <>🟢 <strong>Live</strong> — Freddie Mac PMMS week of {ratesDate} · Prime Rate: {liveRates.prime.toFixed(2)}%</>
                    : ratesError
                    ? "⚠ Could not load live rates — showing last known rates"
                    : "⏳ Loading live rates from Freddie Mac PMMS..."}
                </p>
              </div>
              <div style={{ fontSize: "0.62rem", color: S.muted, background: "#f5f8fc", border: `1px solid ${S.border}`, borderRadius: "6px", padding: "0.4rem 0.75rem" }}>
                Rates change weekly. Always verify with your lender.
              </div>
            </div>

            {/* Live rate cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: "0.75rem", marginBottom: "2rem" }}>
              {(() => {
                const r = liveRates || {};
                const fallback = MARKET_RATES.rates;
                const cards = [
                  { label: "30yr Fixed",     rate: r.rate30  ?? fallback[0].rate,  live: !!liveRates, src: "Freddie Mac PMMS" },
                  { label: "15yr Fixed",     rate: r.rate15  ?? fallback[1].rate,  live: !!liveRates, src: "Freddie Mac PMMS" },
                  { label: "30yr FHA",       rate: r.fha30   ?? fallback[2].rate,  live: !!liveRates, src: "Derived: 30yr − 0.17%" },
                  { label: "30yr VA",        rate: r.va30    ?? fallback[3].rate,  live: !!liveRates, src: "Derived: 30yr − 0.61%" },
                  { label: "30yr USDA",      rate: r.usda    ?? fallback[4].rate,  live: !!liveRates, src: "Derived: 30yr − 0.24%" },
                  { label: "30yr Jumbo",     rate: r.jumbo30 ?? fallback[5].rate,  live: !!liveRates, src: "Derived: 30yr + 0.19%" },
                  { label: "5/6 ARM",        rate: r.arm51   ?? fallback[6].rate,  live: !!liveRates, src: "Derived: 30yr − 0.26%" },
                  { label: "7/6 ARM",        rate: r.arm71   ?? fallback[7].rate,  live: !!liveRates, src: "Derived: 30yr − 0.14%" },
                  { label: "HELOC",          rate: r.heloc   ?? fallback[8].rate,  live: !!liveRates, src: "Prime + 0.50%" },
                  { label: "HE Loan",        rate: r.heloan  ?? fallback[9].rate,  live: !!liveRates, src: "Prime + 0.35%" },
                  { label: "Cash-Out Refi",  rate: r.cashout ?? 6.69,             live: !!liveRates, src: "Derived: 30yr + 0.33%" },
                  { label: "DSCR (740/75%)", rate: 7.25,  live: false, src: "Industry avg — updated monthly" },
                  { label: "Hard Money",     rate: 11.50, live: false, src: "Industry avg 10.5–12.5%" },
                ];
                return cards.map(card => (
                  <Card key={card.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
                      <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: S.muted }}>{card.label}</div>
                      {card.live
                        ? <span style={{ fontSize: "0.52rem", background: "#f0fdf4", color: "#15803d", border: "1px solid #86efac", borderRadius: "3px", padding: "0.1rem 0.35rem", fontWeight: 700 }}>LIVE</span>
                        : <span style={{ fontSize: "0.52rem", background: "#f5f8fc", color: S.muted, border: `1px solid ${S.border}`, borderRadius: "3px", padding: "0.1rem 0.35rem" }}>EST</span>
                      }
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "0.4rem" }}>
                      <span style={{ fontSize: "1.75rem", fontWeight: 900, color: S.text, fontFamily: "'DM Mono', monospace", lineHeight: 1 }}>
                        {liveRates || ratesError ? card.rate.toFixed(2) : "—"}
                        <span style={{ fontSize: "1rem" }}>%</span>
                      </span>
                    </div>
                    <div style={{ fontSize: "0.58rem", color: "#9ba8b5", marginTop: "0.3rem" }}>{card.src}</div>
                  </Card>
                ));
              })()}
            </div>

            {/* Rate context table */}
            <Card style={{ marginBottom: "1.25rem" }}>
              <SectionHead label="Loan Type Reference Guide" />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.71rem", minWidth: "600px" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                      {["Loan Type", "Min Down", "Min Credit", "PMI/MIP", "Key Feature", "Best For"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "0.45rem 0.65rem", color: S.muted, fontSize: "0.6rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Conventional", "3%", "620", "Yes (<20%)", "No upfront fees", "Good credit buyers"],
                      ["FHA", "3.5% (580+)", "500", "Required (life)", "Low credit OK", "First-time, lower credit"],
                      ["VA", "0%", "580 (typ.)", "None", "No PMI ever", "Veterans & active military"],
                      ["USDA", "0%", "640", "Guarantee fee", "Rural areas only", "Low-income rural buyers"],
                      ["Jumbo", "10–20%", "700+", "Varies", "Above $802,650 limit", "High-cost home buyers"],
                      ["ARM 5/6", "3%", "620", "Yes (<20%)", "Lower initial rate", "Short-term ownership plan"],
                      ["HELOC", "N/A", "620", "Possible", "Revolving credit line", "Ongoing home expenses"],
                      ["HE Loan", "N/A", "620", "Possible", "Fixed lump sum", "Single large expense"],
                      ["DSCR", "20–25%", "640", "No", "No income docs", "Real estate investors"],
                      ["Hard Money", "30–40%", "None req.", "No", "Speed (7–14 days)", "Fix & flip, bridge"],
                      ["Reverse/HECM", "N/A (62+)", "N/A", "MIP", "No monthly payments", "Senior home equity access"],
                    ].map((row, i) => (
                      <tr key={i} style={{ borderBottom: `1px solid #edf0f5`, background: i % 2 ? "#f9fbfd" : "#ffffff" }}>
                        {row.map((cell, j) => (
                          <td key={j} style={{ padding: "0.4rem 0.65rem", color: j === 0 ? S.accent : S.muted, fontWeight: j === 0 ? 700 : 400, fontSize: "0.69rem" }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Alert type="tip">🟢 Live rates (30yr, 15yr, Prime) update automatically each week from Freddie Mac PMMS via the Federal Reserve FRED database. FHA, VA, USDA, ARM, HELOC, and HE Loan rates are derived using historical spreads. DSCR and Hard Money rates are manually updated monthly. Always verify with your lender before making any decisions.</Alert>
          {/* Resources & Guides */}
            <div style={{ marginTop: "2rem" }}>
              <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: S.muted, marginBottom: "1rem" }}>📚 Resources & Guides</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px,1fr))", gap: "0.75rem" }}>
                {[
                  {
                    title: "DSCR Loan Calculator: How to Qualify Based on Rental Income",
                    desc: "Learn how DSCR loans work, what ratio you need, and how to run the numbers on any rental property.",
                    tag: "Investment Loans",
                    color: "#b45309",
                    bg: "#fff7ed",
                    border: "#fdba74",
                    href: "/dscr-loan-calculator.html",
                    time: "6 min read",
                  },
                  {
                    title: "Cash-Out Refinance Calculator: How Much Can You Pull Out?",
                    desc: "Learn the 80% LTV rule, how your new payment is calculated, and when a cash-out refi makes sense vs. a HELOC.",
                    tag: "Home Equity",
                    color: "#059669",
                    bg: "#f0fdf4",
                    border: "#86efac",
                    href: "/cash-out-refinance-calculator.html",
                    time: "7 min read",
                  },
                  {
                    title: "How Much Can I Borrow Against My Home?",
                    desc: "Learn the 80% LTV rule, how lenders calculate your max, and which equity product is right for your situation.",
                    tag: "Home Equity",
                    color: "#059669",
                    bg: "#f0fdf4",
                    border: "#86efac",
                    href: "/how-much-can-i-borrow-against-my-home.html",
                    time: "7 min read",
                  },
                ].map(article => (
                  <a key={article.href} href={article.href} style={{ textDecoration: "none", display: "block", background: "#fff", border: `1px solid rgba(0,0,0,0.08)`, borderRadius: "12px", padding: "1.25rem", transition: "box-shadow 0.15s", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.6rem" }}>
                      <span style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", background: article.bg, color: article.color, border: `1px solid ${article.border}`, borderRadius: "4px", padding: "0.15rem 0.5rem" }}>{article.tag}</span>
                      <span style={{ fontSize: "0.6rem", color: S.muted }}>{article.time}</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#0f1f35", lineHeight: 1.35, marginBottom: "0.4rem" }}>{article.title}</div>
                    <div style={{ fontSize: "0.72rem", color: S.muted, lineHeight: 1.5 }}>{article.desc}</div>
                    <div style={{ marginTop: "0.75rem", fontSize: "0.72rem", color: S.accent, fontWeight: 600 }}>Read article →</div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: LOAN CALCULATOR
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "calc" && (
          <div>
            {/* Loan type grid */}
            <div style={{ marginBottom: "1.25rem" }}>
              {LOAN_CATEGORIES.map(cat => (
                <div key={cat.category} style={{ marginBottom: "0.75rem" }}>
                  <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: cat.color, marginBottom: "0.4rem" }}>{cat.category}</div>
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    {cat.loans.map(l => (
                      <button key={l.id} onClick={() => setLoanId(l.id)} style={{
                        padding: "0.3rem 0.75rem", borderRadius: "6px",
                        border: `1px solid ${loanId === l.id ? cat.color : "rgba(0,0,0,0.1)"}`,
                        background: loanId === l.id ? cat.color + "18" : "#f5f8fc",
                        color: loanId === l.id ? cat.color : S.muted,
                        fontSize: "0.7rem", fontWeight: loanId === l.id ? 700 : 400,
                        cursor: "pointer", fontFamily: "inherit", transition: "all 0.11s",
                      }}>{l.label}</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Loan-type specific notices */}
            {loan.group === "fha"    && <Alert type="tip">FHA adds a 1.75% upfront MIP ({$(fhaUp)}) rolled into the loan + 0.55%/yr annual MIP for the life of the loan if down &lt; 10%. Cannot cancel MIP — you may need to refinance to a conventional loan to remove it.</Alert>}
            {loan.group === "va"     && <Alert type="good">VA loans have no PMI. The funding fee ({pc(downPct >= 10 ? 1.4 : 2.15)}) covers insurance for the government. First-time use: 2.15% (down &lt;10%), 1.4% (down 10%+). Disabled veterans may be exempt. Confirm eligibility at va.gov.</Alert>}
            {loan.group === "usda"   && <Alert type="tip">USDA requires the property to be in an eligible rural area and borrower income must be within limits (~115% of area median). Check eligibility at eligibility.sc.egov.usda.gov.</Alert>}
            {loan.group === "arm"    && <Alert type="warn">ARM rates are fixed for {loan.fixedYrs} years, then adjust every 6 months based on the SOFR index + margin. Your payment could rise significantly after the fixed period. Model the worst case using the lifetime cap.</Alert>}
            {loan.group === "hard"   && <Alert type="warn">Hard money rates are typically 10–13% with 1–3% origination points. Terms are 6–24 months. These are asset-based loans — qualification is primarily on the property value, not your income or credit.</Alert>}
            {loan.group === "bridge" && <Alert type="warn">Bridge loans are short-term (6–24 mo) at higher rates, used to purchase before selling your current home. Have a clear exit strategy — sale, refinance, or construction completion.</Alert>}
            {loan.group === "io"     && <Alert type="warn">Interest-only payments don't reduce the principal balance. After the I/O period ({loan.ioYrs || 10} yrs), your payment jumps significantly as P&I payments begin on the full original balance over the remaining term.</Alert>}
            {loan.group === "balloon" && <Alert type="warn">Balloon loan: you make regular payments for {loan.balloonYrs || 7} years, then the ENTIRE remaining balance is due at once. You must have a refinance or sale plan in place before the balloon date.</Alert>}
            {loan.group === "reverse" && <Alert type="tip">Reverse mortgages (HECM): for homeowners 62+. No monthly payment required. Balance grows over time. Loan becomes due when you sell, move out, or pass away. HUD counseling is required. Call 1-800-569-4287.</Alert>}

            <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,1fr) minmax(300px,1.2fr)", gap: "1.25rem" }}>
              {/* LEFT: Inputs */}
              <div>
                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Loan Details" />
                  <DualInput label="Home Price / Purchase Price" value={homePrice} min={50000} max={5000000} step={1000} onChange={setHomePrice} prefix="$" integer />
                  <DualInput label="Down Payment %" value={downPct} min={0} max={50} step={0.5} onChange={setDownPct} suffix="%" note={`Down: ${$(homePrice * downPct / 100)} · Loan: ${$(principal)}`} badge={downPct < 20 && loan.group === "conv" ? "PMI" : undefined} />
                  <DualInput label="Interest Rate (APR)" value={rate} min={0.5} max={25} step={0.025} onChange={setRate} suffix="%" note={`Current avg for this type: ~${pc(loan.defaultRate / 100)}`} />
                  <div style={{ marginBottom: "1rem" }}>
                    <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted, marginBottom: "0.4rem" }}>Loan Term (years)</div>
                    <Pills value={termYrs} onChange={setTermYrs} options={[5,7,10,15,20,25,30,40].map(v => ({ v, l: v + "yr" }))} color={loan.catColor} />
                  </div>
                </Card>

                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Monthly Costs" />
                  <DualInput label="Property Tax Rate (annual)" value={propTax} min={0} max={5} step={0.05} onChange={setPropTax} suffix="%" note={`${$(monthlyTax, 2)}/mo · Avg US: 1.1%. Check your county assessor.`} />
                  <DualInput label="Homeowners Insurance" value={insurance} min={0} max={1000} step={5} onChange={setInsurance} prefix="$" suffix="/mo" />
                  <DualInput label="HOA Fees" value={hoa} min={0} max={3000} step={25} onChange={setHoa} prefix="$" suffix="/mo" note="Enter 0 if no HOA." />
                </Card>

                {/* ARM adjustable inputs */}
                {loan.group === "arm" && (
                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label={`ARM Scenario (${loan.fixedYrs}yr fixed then adjusts)`} />
                    <DualInput label="Expected Rate Increase After Fixed Period" value={armAdj} min={0} max={5} step={0.25} onChange={setArmAdj} prefix="+" suffix="%" note="Conservative estimate. Tied to SOFR index + lender margin." />
                    <DualInput label="Lifetime Rate Cap" value={armCap} min={1} max={8} step={0.5} onChange={setArmCap} prefix="+" suffix="%" note={`Max possible rate: ${pc((rate + armCap) / 100)} · Max payment: ${$2(calcMP(principal, rate + armCap, months))}/mo`} />
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem" }}>
                      <Stat label="Initial Pmt" value={$2(basePmt)} color={S.green} />
                      <Stat label={`After +${armAdj}%`} value={$2(calcMP(principal, rate + armAdj, months))} color={S.gold} />
                      <Stat label="At Rate Cap" value={$2(calcMP(principal, rate + armCap, months))} color={S.red} />
                    </div>
                  </Card>
                )}

                {/* Extra payments */}
                <Card style={{ marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showExtras ? "1rem" : 0 }}>
                    <SectionHead label="Extra Payments (Prepayment)" />
                    <button onClick={() => setShowExtras(v => !v)} style={{ fontSize: "0.65rem", color: S.accent, background: "#eff8ff", border: `1px solid #bae6fd`, borderRadius: "5px", padding: "0.2rem 0.55rem", cursor: "pointer", fontFamily: "inherit" }}>
                      {showExtras ? "Hide" : "Show"}
                    </button>
                  </div>
                  {showExtras && (
                    <>
                      <DualInput label="Extra Monthly Payment" value={extraMo} min={0} max={5000} step={25} onChange={setExtraMo} prefix="$" suffix="/mo" note="Applied to principal every month — reduces payoff time and total interest dramatically." />
                      <DualInput label="One-Time Lump Sum" value={extraOnce} min={0} max={500000} step={500} onChange={setExtraOnce} prefix="$" note="Tax refund, bonus, inheritance, etc." />
                      {(extraMo > 0 || extraOnce > 0) && (
                        <DualInput label="Starting at Payment #" value={extraMonth} min={1} max={months} step={1} onChange={setExtraMonth} suffix="" />
                      )}
                      {(extraMo > 0 || extraOnce > 0) && moSaved > 0 && (
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.5rem" }}>
                          <Stat label="Months Saved" value={moSaved + " mo"} color={S.green} />
                          <Stat label="Interest Saved" value={$(intSaved)} color={S.green} />
                          <Stat label="Paid Off In" value={(schedule.length / 12).toFixed(1) + " yrs"} color={S.green} />
                          <Stat label="New Total Cost" value={$(basePmt * schedule.length)} />
                        </div>
                      )}
                    </>
                  )}
                </Card>
              </div>

              {/* RIGHT: Results */}
              <div>
                {/* Big payment number */}
                <div style={{ background: `linear-gradient(135deg, #eff8ff, #e0f2fe)`, border: `1px solid #bae6fd`, borderRadius: "13px", padding: "1.5rem", marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.58rem", letterSpacing: "0.15em", textTransform: "uppercase", color: S.muted, marginBottom: "0.2rem" }}>
                    {loan.group === "io" ? "Interest-Only Monthly Payment" : "Total Monthly (PITI+)"}
                  </div>
                  <div style={{ fontSize: "2.8rem", fontWeight: 800, color: S.accent, fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em", lineHeight: 1 }}>{$(totalPITI)}</div>
                  <div style={{ fontSize: "0.67rem", color: S.muted, marginTop: "0.4rem", lineHeight: 1.5 }}>
                    {$2(displayPmt)} P&I · {$2(monthlyTax)} tax · {$2(insurance)} ins
                    {pmi > 0 ? ` · ${$2(pmi)} PMI` : ""}{fhaMIP > 0 ? ` · ${$2(fhaMIP)} MIP` : ""}{hoa > 0 ? ` · ${$(hoa)} HOA` : ""}
                  </div>
                  {loan.group === "io" && (
                    <div style={{ marginTop: "0.75rem", padding: "0.55rem 0.85rem", background: "#fef2f2", borderRadius: "6px", border: "1px solid #fecaca" }}>
                      <span style={{ fontSize: "0.67rem", color: "#991b1b" }}>After I/O period ({loan.ioYrs || 10}yr): P&I payment becomes {$2(calcMP(principal, rate, (termYrs - (loan.ioYrs || 10)) * 12))}/mo</span>
                    </div>
                  )}
                  {loan.group === "balloon" && (
                    <div style={{ marginTop: "0.75rem", padding: "0.55rem 0.85rem", background: "#fef2f2", borderRadius: "6px", border: "1px solid #fecaca" }}>
                      <span style={{ fontSize: "0.67rem", color: "#991b1b" }}>Balloon due at year {loan.balloonYrs || 7}: {$(schedBase[Math.min((loan.balloonYrs || 7) * 12 - 1, schedBase.length - 1)]?.balance || 0)}</span>
                    </div>
                  )}
                </div>

                {/* Stat grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.65rem", marginBottom: "1rem" }}>
                  <Stat label="Loan Amount" value={$(principal)} sub={`${pc(downPct / 100)} down`} large />
                  <Stat label="LTV Ratio" value={pc(ltv * 100)} warn={ltv > 0.97} sub={ltv > 0.8 ? (loan.group === "conv" ? `PMI until mo ${pmiDropMonth || "?"}` : "High LTV") : "No PMI needed"} />
                  <Stat label="Total Interest" value={$(baseInt)} color={S.gold} warn={baseInt > principal} sub={`${pc(baseInt / principal * 100)} of loan amt`} />
                  <Stat label="Total Paid (P+I)" value={$(basePmt * months)} sub={`Over ${termYrs} yrs`} />
                </div>

                {/* Monthly breakdown */}
                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Full Monthly Breakdown" />
                  <Row label="Principal & Interest" value={$2(displayPmt)} hi />
                  {pmi > 0    && <Row label={`PMI (cancels ~mo ${pmiDropMonth})`} value={$2(pmi)} note="Cancels automatically at 80% LTV (Homeowners Protection Act)" />}
                  {fhaMIP > 0 && <Row label="FHA MIP (annual, monthly)" value={$2(fhaMIP)} note="Cannot cancel if down < 10% — refi to conventional to remove" warn />}
                  <Row label="Property Tax" value={$2(monthlyTax)} />
                  <Row label="Homeowners Insurance" value={$2(insurance)} />
                  {hoa > 0    && <Row label="HOA" value={$(hoa)} />}
                  <Divider />
                  <Row label="Total Monthly (PITI+)" value={$(totalPITI)} hi />
                  <Divider />
                  <Row label="Balance at Year 5"  value={$(bal5)}  note="Loan paydown progress" />
                  <Row label="Balance at Year 10" value={$(bal10)} />
                  {termYrs >= 20 && <Row label="Balance at Year 15" value={$(bal15)} />}
                  <Divider />
                  <Row label="Total Interest (full term)" value={$(baseInt)} warn />
                  <Divider />
                  {(() => {
                    const rules = DTI_RULES[loan.group] || DTI_RULES.fixed;
                    if (!rules.fe && !rules.be) {
                      return <Row label="Qualifying Income" value="Not income-based" note={rules.src} hi />;
                    }
                    const feIncome = rules.fe ? totalPITI / rules.fe : null;
                    const beIncome = rules.be ? totalPITI / rules.be : null;
                    return (
                      <>
                        {feIncome && <Row label={`Min. Qualifying Income (${Math.round(rules.fe * 100)}% front-end DTI)`} value={$(feIncome) + "/mo · " + $(feIncome * 12) + "/yr"} hi note={rules.src} />}
                        {beIncome && feIncome && <Row label={`Min. Income if no other debts (${Math.round(rules.be * 100)}% max back-end DTI)`} value={$(beIncome) + "/mo · " + $(beIncome * 12) + "/yr"} note="If your only debt is this mortgage, lenders apply the back-end cap — allowing lower income to qualify" />}
                        {beIncome && !feIncome && <Row label={`Min. Qualifying Income (${Math.round(rules.be * 100)}% back-end DTI)`} value={$(beIncome) + "/mo · " + $(beIncome * 12) + "/yr"} hi note={rules.src} />}
                      </>
                    );
                  })()}
                </Card>

                {/* Principal vs Interest */}
                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Payment Composition" />
                  <PrinIntBar principal={basePmt - (principal * rate / 100 / 12)} interest={principal * rate / 100 / 12} pmi={pmi} tax={monthlyTax} ins={insurance} hoa={hoa} />
                  {baseInt > principal && <Alert type="warn">Over {termYrs} years you'll pay {$( baseInt)} in interest — more than you borrowed ({$(principal)}). A {termYrs === 30 ? "15-year" : "10-year"} term or extra payments could save {$(baseInt - calcTotalInterest(principal, rate, Math.round(months * 0.5)))}+.</Alert>}
                </Card>

                {/* Amortization */}
                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: showAmort ? "1rem" : 0 }}>
                    <SectionHead label="Full Amortization Schedule" />
                    <button onClick={() => setShowAmort(v => !v)} style={{ fontSize: "0.65rem", color: S.accent, background: "#eff8ff", border: `1px solid #bae6fd`, borderRadius: "5px", padding: "0.2rem 0.55rem", cursor: "pointer", fontFamily: "inherit" }}>
                      {showAmort ? "Hide" : "Show All " + schedBase.length + " Payments"}
                    </button>
                  </div>
                  {showAmort && <AmortTable schedule={schedBase} view={amortView} setView={setAmortView} />}
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: EQUITY CALCULATOR
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "equity" && (
          <div>
            {/* Product selector at top */}
            <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
              {[
                { v: "heloc",      l: "🔄 HELOC",              desc: "Revolving credit line · Variable rate" },
                { v: "heloan",     l: "💵 Home Equity Loan",   desc: "Fixed lump sum · Fixed rate" },
                { v: "cashout",    l: "🏦 Cash-Out Refinance", desc: "Replace your mortgage + get cash" },
                { v: "freeclear",  l: "🔑 Own It Free & Clear", desc: "No mortgage — access equity with a new loan" },
              ].map(opt => (
                <button key={opt.v} onClick={() => setEqType(opt.v)} style={{
                  padding: "0.75rem 1.25rem", borderRadius: "10px", fontFamily: "inherit",
                  border: `2px solid ${eqType === opt.v ? S.green : "rgba(0,0,0,0.1)"}`,
                  background: eqType === opt.v ? "#f0fdf4" : "#f5f8fc",
                  cursor: "pointer", textAlign: "left", transition: "all 0.15s",
                }}>
                  <div style={{ fontWeight: 700, fontSize: "0.82rem", color: eqType === opt.v ? S.green : S.text }}>{opt.l}</div>
                  <div style={{ fontSize: "0.63rem", color: S.muted, marginTop: "0.2rem" }}>{opt.desc}</div>
                </button>
              ))}
            </div>

            {/* ── CASH-OUT REFI ─────────────────────────────────── */}
            {eqType === "cashout" && (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,1fr) minmax(300px,1.3fr)", gap: "1.25rem" }}>

                {/* LEFT — Inputs */}
                <div>
                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Your Current Mortgage" />
                    <DualInput label="Current Home Value" value={eqHomeVal} min={50000} max={5000000} step={5000} onChange={setEqHomeVal} prefix="$" integer note="Lender will order an appraisal — use Zillow/Redfin as an estimate." />
                    <DualInput label="Current Mortgage Balance" value={eqMortBal} min={0} max={eqHomeVal} step={1000} onChange={setEqMortBal} prefix="$" integer note="From your latest mortgage statement." />
                    <DualInput label="Current Interest Rate" value={coCurrentRate} min={1} max={14} step={0.125} onChange={setCoCurrentRate} suffix="%" note="The rate on your existing mortgage." />
                    <DualInput label="Remaining Months on Current Loan" value={coCurrentRemMo} min={1} max={360} step={1} onChange={setCoCurrentRemMo} suffix=" mo" note={`${(coCurrentRemMo / 12).toFixed(1)} years left · Calculated P&I: ${$2(coCalcPmt)}/mo`} />

                    {/* Current payment toggle */}
                    <div style={{ borderTop: `1px solid ${S.dim}`, paddingTop: "1rem", marginTop: "0.25rem" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
                        <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted }}>I know my actual monthly payment</span>
                        <button
                          onClick={() => setCoKnowPayment(v => !v)}
                          style={{
                            width: "40px", height: "22px", borderRadius: "11px",
                            background: coKnowPayment ? S.green : "#d1d8e0",
                            border: "none", cursor: "pointer", position: "relative",
                            transition: "background 0.2s", flexShrink: 0,
                          }}
                        >
                          <div style={{
                            position: "absolute", top: "3px",
                            left: coKnowPayment ? "21px" : "3px",
                            width: "16px", height: "16px", borderRadius: "50%",
                            background: "#fff", transition: "left 0.2s",
                            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                          }} />
                        </button>
                      </div>

                      {coKnowPayment && (
                        <div>
                          <DualInput
                            label="My Current Monthly Payment"
                            value={coActualPmt}
                            min={100}
                            max={20000}
                            step={25}
                            onChange={setCoActualPmt}
                            prefix="$"
                            suffix="/mo"
                            integer
                            note="Enter exactly what you pay each month — from your bank statement or coupon book."
                          />

                          {/* Escrow checkbox */}
                          <div style={{ background: "#f5f8fc", border: `1px solid ${S.border}`, borderRadius: "8px", padding: "0.9rem 1rem", marginBottom: "1rem" }}>
                            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", cursor: "pointer" }}>
                              <div style={{ position: "relative", flexShrink: 0, marginTop: "1px" }}>
                                <input
                                  type="checkbox"
                                  checked={coEscrowIncluded}
                                  onChange={e => setCoEscrowIncluded(e.target.checked)}
                                  style={{ width: "16px", height: "16px", accentColor: S.green, cursor: "pointer" }}
                                />
                              </div>
                              <div>
                                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: S.text, lineHeight: 1.3 }}>
                                  My payment includes taxes &amp; insurance (escrow account)
                                </div>
                                <div style={{ fontSize: "0.63rem", color: S.muted, marginTop: "0.25rem", lineHeight: 1.45 }}>
                                  Check this if your lender collects property taxes and homeowners insurance as part of your monthly payment. Most mortgages with less than 20% down are required to use escrow.
                                </div>
                              </div>
                            </label>

                            {coEscrowIncluded && (
                              <div style={{ marginTop: "0.9rem", paddingTop: "0.9rem", borderTop: `1px solid ${S.dim}` }}>
                                <div style={{ fontSize: "0.63rem", color: S.muted, marginBottom: "0.75rem" }}>
                                  Break out your escrow amounts so we can compare P&I only. Check your annual escrow statement or mortgage statement.
                                </div>
                                <DualInput
                                  label="Monthly Property Tax (escrow)"
                                  value={coMonthlyTax}
                                  min={0}
                                  max={3000}
                                  step={10}
                                  onChange={setCoMonthlyTax}
                                  prefix="$"
                                  suffix="/mo"
                                  integer
                                  note="Annual tax ÷ 12. Find on your mortgage statement or county assessor website."
                                />
                                <DualInput
                                  label="Monthly Insurance (escrow)"
                                  value={coMonthlyIns}
                                  min={0}
                                  max={1000}
                                  step={10}
                                  onChange={setCoMonthlyIns}
                                  prefix="$"
                                  suffix="/mo"
                                  integer
                                  note="Annual homeowners insurance premium ÷ 12."
                                />
                                {/* Live escrow breakdown */}
                                <div style={{ background: "#eff8ff", border: "1px solid #bae6fd", borderRadius: "7px", padding: "0.75rem", marginTop: "0.25rem" }}>
                                  <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.accent, marginBottom: "0.5rem" }}>Your Payment Breakdown</div>
                                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.25rem 1rem" }}>
                                    {[
                                      { l: "Total payment entered", v: coActualPmt },
                                      { l: "− Property tax (escrow)", v: coMonthlyTax },
                                      { l: "− Homeowners insurance (escrow)", v: coMonthlyIns },
                                    ].map(r => (
                                      <React.Fragment key={r.l}>
                                        <span style={{ fontSize: "0.68rem", color: S.muted }}>{r.l}</span>
                                        <span style={{ fontSize: "0.72rem", fontFamily: "'DM Mono', monospace", color: S.text, textAlign: "right" }}>{$2(r.v)}</span>
                                      </React.Fragment>
                                    ))}
                                    <div style={{ gridColumn: "1 / -1", height: "1px", background: "#bae6fd", margin: "0.3rem 0" }} />
                                    <span style={{ fontSize: "0.72rem", fontWeight: 700, color: S.accent }}>P&amp;I only</span>
                                    <span style={{ fontSize: "0.82rem", fontWeight: 800, fontFamily: "'DM Mono', monospace", color: S.accent, textAlign: "right" }}>{$2(coPandI)}</span>
                                  </div>
                                  {coPandI < 0 && (
                                    <p style={{ fontSize: "0.62rem", color: S.red, marginTop: "0.5rem", marginBottom: 0 }}>⚠ Escrow amounts exceed total payment — check your entries.</p>
                                  )}
                                </div>
                              </div>
                            )}

                            {coKnowPayment && !coEscrowIncluded && Math.abs(coActualPmt - coCalcPmt) > 50 && (
                              <div style={{ marginTop: "0.75rem", background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: "6px", padding: "0.6rem 0.75rem", fontSize: "0.67rem", color: "#92400e" }}>
                                💡 Your entered payment ({$2(coActualPmt)}) differs from the calculated P&I ({$2(coCalcPmt)}) by {$2(Math.abs(coActualPmt - coCalcPmt))}. If you pay into an escrow account, check the box above so we can isolate the P&I portion for an accurate comparison.
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Summary line when toggle is off */}
                      {!coKnowPayment && (
                        <div style={{ fontSize: "0.67rem", color: S.muted, background: "#f5f8fc", borderRadius: "6px", padding: "0.55rem 0.75rem" }}>
                          Using calculated payment of <strong style={{ color: S.text, fontFamily: "'DM Mono', monospace" }}>{$2(coCalcPmt)}/mo</strong> based on your rate, balance, and remaining term. Toggle on above if you want to enter your actual statement payment.
                        </div>
                      )}
                    </div>
                  </Card>

                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Cash You Want to Pull Out" />
                    <DualInput
                      label="Cash-Out Amount"
                      value={coCashWanted}
                      min={0}
                      max={Math.max(1000, coMaxCash80 + 50000)}
                      step={1000}
                      onChange={setCoCashWanted}
                      prefix="$"
                      integer
                      note={`Max at 80% LTV: ${$(coMaxCash80)} · Max at 85% LTV: ${$(coMaxCash85)} · Most lenders cap cash-out at 80%.`}
                      badge={coCashWanted > coMaxCash80 ? "Over 80% limit" : undefined}
                    />
                    {coCashWanted > coMaxCash80 && coCashWanted <= coMaxCash85 && (
                      <Alert type="warn">You're between 80–85% LTV. Some lenders allow this but expect a higher rate (+0.25–0.75%). Calculator uses {$(coSafeCash)} (80% max).</Alert>
                    )}
                    {coCashWanted > coMaxCash85 && (
                      <Alert type="warn">Requested amount exceeds 85% LTV. Most lenders won't go above 80% for cash-out. Calculator uses max available: {$(coSafeCash)}.</Alert>
                    )}
                  </Card>

                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="New Loan Terms" />
                    <DualInput label="New Interest Rate (APR)" value={coNewRate} min={2} max={14} step={0.125} onChange={setCoNewRate} suffix="%" note="Current cash-out refi avg: ~6.69%. May 2026 per Bankrate." />
                    <div style={{ marginBottom: "1rem" }}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted, marginBottom: "0.4rem" }}>New Loan Term</div>
                      <Pills value={coNewTerm} onChange={setCoNewTerm} options={[{ v: 10, l: "10yr" }, { v: 15, l: "15yr" }, { v: 20, l: "20yr" }, { v: 25, l: "25yr" }, { v: 30, l: "30yr" }]} color={S.green} />
                      {coNewTerm > coCurrentRemMo / 12 + 2 && (
                        <p style={{ fontSize: "0.62rem", color: S.gold, marginTop: "0.4rem" }}>⚠ You're extending your loan term — this lowers the monthly payment but increases total interest paid significantly.</p>
                      )}
                    </div>
                    <DualInput label="Closing Costs %" value={coClosingPct} min={0} max={6} step={0.25} onChange={setCoClosingPct} suffix="%" note={`Estimated closing costs: ${$(coClosingDollars)} · Typical range: 2–3% of new loan amount.`} />
                    <div style={{ marginBottom: "0.5rem" }}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted, marginBottom: "0.4rem" }}>Closing Costs</div>
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        {[{ v: true, l: "Roll into loan" }, { v: false, l: "Pay upfront" }].map(opt => (
                          <button key={String(opt.v)} onClick={() => setCoRollClosing(opt.v)} style={{
                            padding: "0.35rem 0.85rem", borderRadius: "6px", fontFamily: "inherit",
                            border: `1px solid ${coRollClosing === opt.v ? S.green : "rgba(0,0,0,0.1)"}`,
                            background: coRollClosing === opt.v ? "#f0fdf4" : "#f5f8fc",
                            color: coRollClosing === opt.v ? S.green : S.muted,
                            fontSize: "0.72rem", fontWeight: coRollClosing === opt.v ? 700 : 400,
                            cursor: "pointer", transition: "all 0.12s",
                          }}>{opt.l}</button>
                        ))}
                      </div>
                      <p style={{ fontSize: "0.61rem", color: "#7a8fa8", marginTop: "0.35rem", fontStyle: "italic" }}>
                        {coRollClosing ? "Closing costs added to loan balance — nothing due at closing but you pay interest on them." : "Closing costs paid out of pocket at closing — lower loan balance, better long-term."}
                      </p>
                    </div>
                  </Card>
                </div>

                {/* RIGHT — Results */}
                <div>
                  {/* Cash at closing hero */}
                  <div style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "1px solid #86efac", borderRadius: "13px", padding: "1.5rem", marginBottom: "1rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                      <div>
                        <div style={{ fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: S.muted, marginBottom: "0.2rem" }}>Cash at Closing</div>
                        <div style={{ fontSize: "2.6rem", fontWeight: 900, color: S.green, fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em", lineHeight: 1 }}>{$(Math.max(0, coCashAtClose))}</div>
                        <div style={{ fontSize: "0.65rem", color: S.muted, marginTop: "0.3rem" }}>
                          {coRollClosing ? "Closing costs rolled in — $0 due at closing" : `After ${$(coClosingDollars)} closing costs paid upfront`}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: S.muted, marginBottom: "0.2rem" }}>New Monthly Payment</div>
                        <div style={{ fontSize: "2.6rem", fontWeight: 900, color: coPmtDiff > 150 ? S.red : coPmtDiff > 0 ? S.gold : S.accent, fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em", lineHeight: 1 }}>{$2(coNewPmt)}</div>
                        <div style={{ fontSize: "0.65rem", color: S.muted, marginTop: "0.3rem" }}>
                          P&I only · {coPmtDiff > 0 ? `▲ ${$2(coPmtDiff)} more vs current P&I` : `▼ ${$2(Math.abs(coPmtDiff))} less vs current P&I`}
                        </div>
                      </div>
                    </div>
                    {coEscrowIncluded && coKnowPayment && (
                      <div style={{ marginTop: "1rem", paddingTop: "0.85rem", borderTop: "1px solid #86efac", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
                        <div>
                          <div style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.1em", color: S.muted, marginBottom: "0.15rem" }}>New Total (est. w/ escrow)</div>
                          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: S.text, fontFamily: "'DM Mono', monospace" }}>{$2(coNewPmt + coMonthlyTax + coMonthlyIns)}</div>
                          <div style={{ fontSize: "0.6rem", color: S.muted }}>P&I + same T&I escrow</div>
                        </div>
                        <div>
                          <div style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.1em", color: S.muted, marginBottom: "0.15rem" }}>vs. Current Total Payment</div>
                          <div style={{ fontSize: "1.4rem", fontWeight: 800, color: coFullPmtDiff > 0 ? S.red : S.green, fontFamily: "'DM Mono', monospace" }}>
                            {coFullPmtDiff >= 0 ? "+" : ""}{$2(coNewPmt + coMonthlyTax + coMonthlyIns - coActualPmt)}
                          </div>
                          <div style={{ fontSize: "0.6rem", color: S.muted }}>{coFullPmtDiff >= 0 ? "higher" : "lower"} all-in monthly</div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Stats grid */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.65rem", marginBottom: "1rem" }}>
                    <Stat label="New Loan Amount" value={$(coNewLoan)} sub={`${$(eqMortBal)} balance + ${$(coSafeCash)} cash${coRollClosing ? ` + ${$(coClosingDollars)} closing` : ""}`} />
                    <Stat label="New LTV" value={pc(coNewLTV * 100)} warn={coNewLTV > 0.8} sub={coNewLTV > 0.8 ? "Above 80% — expect higher rate" : "Under 80% — best pricing"} />
                    <Stat label={coKnowPayment ? "Current Payment (entered)" : "Current P&I (calculated)"} value={$2(coDisplayPmt)} sub={coEscrowIncluded && coKnowPayment ? `Includes ${$2(coEscrowAmt)}/mo escrow · P&I only: ${$2(coPandI)}` : `${pc(coCurrentRate)} · ${(coCurrentRemMo / 12).toFixed(1)} yrs left`} />
                    <Stat label="New P&I Payment" value={$2(coNewPmt)} color={coPmtDiff > 150 ? S.red : S.accent} sub={`${pc(coNewRate)} · ${coNewTerm} yr term`} />
                  </div>

                  {/* Full breakdown card */}
                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Complete Breakdown" />

                    <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#059669", marginBottom: "0.5rem", marginTop: "0.25rem" }}>📥 What You're Getting</div>
                    <Row label="Cash pulled out" value={$(coSafeCash)} hi />
                    <Row label="Closing costs" value={$(coClosingDollars)} note={coRollClosing ? "Rolled into loan" : "Due at closing"} />
                    <Row label="Net cash in your pocket" value={$(Math.max(0, coCashAtClose))} hi />
                    <Divider />

                    <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#0284c7", marginBottom: "0.5rem", marginTop: "0.5rem" }}>📋 New Loan</div>
                    <Row label="New loan amount" value={$(coNewLoan)} />
                    <Row label="New monthly P&I" value={$2(coNewPmt)} hi />
                    <Row label="New loan LTV" value={pc(coNewLTV * 100)} warn={coNewLTV > 0.8} />
                    <Row label="Total interest on new loan" value={$(coNewTotInt)} warn />
                    <Row label="Total cost (P+I) over term" value={$(coNewPmt * coNewTerm * 12)} />
                    <Divider />

                    <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#b45309", marginBottom: "0.5rem", marginTop: "0.5rem" }}>📊 Old vs. New Comparison</div>
                    <Row label={coKnowPayment ? "Current payment (entered)" : "Current P&I (calculated)"} value={$2(coDisplayPmt)} />
                    {coEscrowIncluded && coKnowPayment && <>
                      <Row label="  − Property tax (escrow)" value={$2(coMonthlyTax)} note="Excluded from P&I comparison" />
                      <Row label="  − Homeowners insurance (escrow)" value={$2(coMonthlyIns)} note="Excluded from P&I comparison" />
                      <Row label="  = Current P&I only" value={$2(coPandI)} hi />
                    </>}
                    <Row label="New monthly P&I" value={$2(coNewPmt)} hi />
                    <Row label="P&I payment change" value={(coPmtDiff >= 0 ? "+" : "") + $2(coPmtDiff) + "/mo"} warn={coPmtDiff > 0} note="Apples-to-apples: P&I only on both loans" />
                    {coEscrowIncluded && coKnowPayment && (
                      <Row label="All-in total payment change (incl. escrow)" value={(coNewPmt + coEscrowAmt - coActualPmt >= 0 ? "+" : "") + $2(coNewPmt + coEscrowAmt - coActualPmt) + "/mo"} warn={coNewPmt + coEscrowAmt > coActualPmt} note="Assumes same tax & insurance escrow amounts" />
                    )}
                    <Row label="Remaining interest on current loan" value={$(coOldRemInt)} />
                    <Row label="Total interest on new loan" value={$(coNewTotInt)} warn />
                    <Row label="Interest difference" value={(coNewTotInt > coOldRemInt ? "+" : "") + $(coNewTotInt - coOldRemInt)} warn={coNewTotInt > coOldRemInt} note="Positive = refinance costs more total interest" />
                    <Divider />

                    {coBreakevenMo && coBreakevenMo > 0 && coBreakevenMo < 600 && (
                      <>
                        <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#6d28d9", marginBottom: "0.5rem", marginTop: "0.5rem" }}>⏱ Break-Even on Closing Costs</div>
                        <Row label="Closing costs to recover" value={$(coClosingDollars)} />
                        <Row label="Monthly payment savings" value={coPmtDiff < 0 ? $2(Math.abs(coPmtDiff)) + "/mo saved" : "Payment increases"} />
                        <Row label="Break-even at month" value={coPmtDiff < 0 ? coBreakevenMo + " mo (" + (coBreakevenMo / 12).toFixed(1) + " yrs)" : "N/A — payment is higher"} hi />
                      </>
                    )}
                  </Card>

                  {/* Available equity summary */}
                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Your Equity Position" />
                    <div style={{ marginBottom: "0.75rem" }}>
                      <EquityMeter equity={Math.max(0, eqHomeVal - eqMortBal)} homeValue={eqHomeVal} />
                    </div>
                    <Row label="Home value" value={$(eqHomeVal)} />
                    <Row label="Current mortgage balance" value={$(eqMortBal)} />
                    <Row label="Current equity" value={$(Math.max(0, eqHomeVal - eqMortBal))} hi />
                    <Divider />
                    <Row label="Max cash-out (80% LTV)" value={$(coMaxCash80)} hi note="Standard limit for most lenders" />
                    <Row label="Max cash-out (85% LTV)" value={$(coMaxCash85)} note="Some lenders — expect higher rate" />
                    <Row label="You're pulling out" value={$(coSafeCash)} />
                    <Row label="Equity remaining after refi" value={$(Math.max(0, eqHomeVal - coNewLoan))} hi />
                  </Card>

                  {/* Smart alerts */}
                  {coCurrentRate < coNewRate && (
                    <Alert type="warn">
                      Your current rate ({pc(coCurrentRate)}) is lower than the new rate ({pc(coNewRate)}). This refi will cost more in interest over time. Only makes sense if you urgently need the cash or plan to sell before break-even.
                    </Alert>
                  )}
                  {coNewTerm > Math.ceil(coCurrentRemMo / 12) + 3 && (
                    <Alert type="warn">
                      You're extending your loan by ~{coNewTerm - Math.ceil(coCurrentRemMo / 12)} years. Your monthly P&I may look lower, but you could be adding {$(Math.max(0, coNewTotInt - coOldRemInt))} in total interest costs.
                    </Alert>
                  )}
                  {coCurrentRate >= coNewRate && coPmtDiff < 0 && (
                    <Alert type="good">
                      Lower rate AND pulling out cash — P&I drops by {$2(Math.abs(coPmtDiff))}/mo. {coBreakevenMo ? `Break-even on closing costs: ${(coBreakevenMo / 12).toFixed(1)} years.` : ""} Strong candidate for refinancing.
                    </Alert>
                  )}
                  {coKnowPayment && coEscrowIncluded && (
                    <Alert type="tip">
                      Your escrow ({$2(coEscrowAmt)}/mo for tax &amp; insurance) stays roughly the same after refinancing — your new lender will set up a new escrow account based on the same property tax and insurance amounts. The comparison above isolates just the P&I change.
                    </Alert>
                  )}
                  <Alert type="tip">
                    Cash-out refis typically close in 30–45 days. Requirements: 620+ credit (740+ for best rates), 20%+ equity remaining after cash-out, debt-to-income under 43–50%, and a new appraisal. Shop at least 3 lenders — rates vary significantly.
                  </Alert>

                  {/* Amortization */}
                  <Card>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: coShowAmort ? "1rem" : 0 }}>
                      <SectionHead label="New Loan Amortization Schedule" />
                      <button onClick={() => setCoShowAmort(v => !v)} style={{ fontSize: "0.65rem", color: S.accent, background: "#eff8ff", border: "1px solid #bae6fd", borderRadius: "5px", padding: "0.2rem 0.55rem", cursor: "pointer", fontFamily: "inherit" }}>
                        {coShowAmort ? "Hide" : `Show all ${coNewTerm * 12} payments`}
                      </button>
                    </div>
                    {coShowAmort && <AmortTable schedule={coNewAmort} view={amortView} setView={setAmortView} />}
                  </Card>
                </div>
              </div>
            )}

            {/* ── FREE & CLEAR ──────────────────────────────────── */}
            {eqType === "freeclear" && (
              <div style={{ display: "grid", gridTemplateColumns: "minmax(300px,1fr) minmax(300px,1.3fr)", gap: "1.25rem" }}>
                <div>
                  <Alert type="good">You own your home free and clear — that's a powerful financial position. With no existing mortgage, lenders treat you as a low-risk borrower and you can access a large portion of your equity. Your home secures the loan, so rates are significantly lower than unsecured debt.</Alert>

                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Your Property" />
                    <DualInput label="Current Home Value" value={fcHomeVal} min={50000} max={5000000} step={5000} onChange={setFcHomeVal} prefix="$" integer note="Use Zillow, Redfin, or a recent appraisal. Lender will order their own." />
                    <div style={{ marginBottom: "1rem" }}>
                      <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted, marginBottom: "0.4rem" }}>What Type of Loan?</div>
                      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                        {[
                          { v: "heloan",   l: "Home Equity Loan", desc: "Lump sum · Fixed rate · Keeps home lien-free flexibility" },
                          { v: "heloc",    l: "HELOC",            desc: "Credit line · Variable rate · Draw as needed" },
                          { v: "firstmort",l: "First Mortgage",   desc: "Traditional mortgage · Best rates · Longer terms available" },
                        ].map(opt => (
                          <button key={opt.v} onClick={() => setFcLoanType(opt.v)} style={{
                            padding: "0.55rem 0.9rem", borderRadius: "8px", fontFamily: "inherit", textAlign: "left",
                            border: `1px solid ${fcLoanType === opt.v ? S.accent : "rgba(0,0,0,0.1)"}`,
                            background: fcLoanType === opt.v ? "#eff8ff" : "#f5f8fc",
                            color: fcLoanType === opt.v ? S.accent : S.muted,
                            fontSize: "0.72rem", fontWeight: fcLoanType === opt.v ? 700 : 400,
                            cursor: "pointer", transition: "all 0.12s", flex: "1 1 160px",
                          }}>
                            <div style={{ fontWeight: 700 }}>{opt.l}</div>
                            <div style={{ fontSize: "0.6rem", marginTop: "0.15rem", opacity: 0.8 }}>{opt.desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  </Card>

                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Loan Details" />
                    <DualInput
                      label="How Much Do You Want to Borrow?"
                      value={fcLoanAmt}
                      min={5000}
                      max={Math.max(5000, fcHomeVal * 0.85)}
                      step={1000}
                      onChange={setFcLoanAmt}
                      prefix="$"
                      integer
                      note={`Max at 70% LTV: ${$(fcMax70)} · Max at 80% LTV: ${$(fcMax80)} · Free & clear homes typically qualify for up to 80%.`}
                      badge={fcLoanAmt > fcMax80 ? "Over 80% LTV" : undefined}
                    />
                    <DualInput label="Interest Rate (APR)" value={fcRate} min={3} max={20} step={0.125} onChange={setFcRate} suffix="%"
                      note={fcLoanType === "heloc" ? "HELOC: tied to Prime Rate. Current avg ~8.5%." : fcLoanType === "firstmort" ? "First mortgage on free & clear home. Rates similar to purchase loans: ~6.4–7%." : "HE Loan avg ~8.35%. Fixed for life."} />
                    {fcLoanType !== "heloc" && (
                      <div style={{ marginBottom: "1rem" }}>
                        <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted, marginBottom: "0.4rem" }}>Term</div>
                        <Pills value={fcTerm} onChange={setFcTerm}
                          options={fcLoanType === "firstmort"
                            ? [{ v: 10, l: "10yr" }, { v: 15, l: "15yr" }, { v: 20, l: "20yr" }, { v: 25, l: "25yr" }, { v: 30, l: "30yr" }]
                            : [{ v: 5, l: "5yr" }, { v: 10, l: "10yr" }, { v: 15, l: "15yr" }, { v: 20, l: "20yr" }]}
                          color={S.accent} />
                      </div>
                    )}
                  </Card>
                </div>

                <div>
                  {/* Equity hero */}
                  <div style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "1px solid #86efac", borderRadius: "13px", padding: "1.5rem", marginBottom: "1rem" }}>
                    <div style={{ fontSize: "0.58rem", letterSpacing: "0.15em", textTransform: "uppercase", color: S.muted, marginBottom: "0.15rem" }}>Your Home Equity (100%)</div>
                    <div style={{ fontSize: "2.8rem", fontWeight: 900, color: S.green, fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em", lineHeight: 1 }}>{$(fcHomeVal)}</div>
                    <div style={{ fontSize: "0.67rem", color: S.muted, marginTop: "0.35rem" }}>You own 100% — no mortgage to subtract</div>
                    <div style={{ marginTop: "1rem" }}>
                      <div style={{ height: "10px", borderRadius: "5px", background: "#86efac", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: "100%", background: "linear-gradient(90deg,#059669,#34d399)" }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.6rem", color: S.muted, marginTop: "0.25rem" }}>
                        <span>100% equity owned</span><span>{$(fcHomeVal)}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: "0.65rem", marginBottom: "1rem" }}>
                    <Stat label="Monthly Payment" value={$2(fcMoPmt)} large color={S.accent} sub={fcLoanType === "heloc" ? "Interest-only (draw period)" : `${fcTerm}-year term`} />
                    <Stat label="LTV After Loan" value={pc(fcLTV * 100)} sub={fcLTV <= 0.7 ? "Very conservative" : fcLTV <= 0.8 ? "Standard limit" : "Above 80% — some lenders OK"} warn={fcLTV > 0.8} />
                    <Stat label="Total Interest" value={$(fcTotInt)} color={S.gold} sub={`${pc(fcTotInt / Math.max(1, fcSafe) * 100)} of loan`} />
                    <Stat label="Total Repaid" value={$(fcSafe + fcTotInt)} sub="Principal + interest" />
                  </div>

                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Borrowing Capacity at Different LTV Limits" />
                    {[
                      { label: "60% LTV (very conservative)", val: fcHomeVal * 0.60, note: "Some lenders offer better rates here" },
                      { label: "70% LTV (common for free & clear)", val: fcHomeVal * 0.70, note: "" },
                      { label: "75% LTV", val: fcHomeVal * 0.75, note: "" },
                      { label: "80% LTV (typical max)", val: fcHomeVal * 0.80, note: "Most lenders' hard limit" },
                    ].map(r => (
                      <div key={r.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0", borderBottom: `1px solid ${S.dim}` }}>
                        <div>
                          <div style={{ fontSize: "0.71rem", color: S.muted }}>{r.label}</div>
                          {r.note && <div style={{ fontSize: "0.59rem", color: "#9ba8b5" }}>{r.note}</div>}
                        </div>
                        <span style={{ fontSize: "0.85rem", fontWeight: 700, color: S.accent, fontFamily: "'DM Mono', monospace" }}>{$(r.val)}</span>
                      </div>
                    ))}
                  </Card>

                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Full Loan Cost Summary" />
                    <Row label="Borrowing" value={$(fcSafe)} hi />
                    <Row label="Monthly Payment" value={$2(fcMoPmt)} hi note={fcLoanType === "heloc" ? "Interest-only during draw period" : undefined} />
                    {fcLoanType === "heloc" && <Row label="P&I Payment (after draw period)" value={$2(calcMP(fcSafe, fcRate, fcTerm * 12))} warn note="Payment increases significantly when draw period ends" />}
                    <Row label="Total Interest" value={$(fcTotInt)} warn />
                    <Row label="Total Repaid" value={$(fcSafe + fcTotInt)} />
                    <Divider />
                    <Row label="LTV After Loan" value={pc(fcLTV * 100)} warn={fcLTV > 0.8} />
                    <Row label="Remaining Equity After Loan" value={$(fcHomeVal - fcSafe)} hi />
                    {(() => {
                      const rules = DTI_RULES[fcLoanType] || DTI_RULES.heloan;
                      const income = rules.fe ? fcMoPmt / rules.fe : rules.be ? fcMoPmt / rules.be : null;
                      const pct = rules.fe || rules.be;
                      return income
                        ? <Row label={`Min. Qualifying Income (${Math.round(pct * 100)}% DTI)`} value={$(income) + "/mo"} note={rules.src} hi />
                        : <Row label="Qualifying Income" value="Not income-based" note={rules.src} hi />;
                    })()}
                  </Card>

                  <Alert type="tip">Free & clear homeowners often qualify for the best rates because there's no competing lien. First-mortgage products typically offer the lowest rates. You may also qualify for a reverse mortgage (HECM) at age 62+ with no required monthly payments — use the Loan Calculator tab to model this.</Alert>

                  {fcLoanType !== "heloc" && fcAmort.length > 0 && (
                    <Card>
                      <SectionHead label="Amortization Schedule" />
                      <AmortTable schedule={fcAmort} view={amortView} setView={setAmortView} />
                    </Card>
                  )}
                </div>
              </div>
            )}
            {(eqType === "heloc" || eqType === "heloan") && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,1fr) minmax(280px,1.3fr)", gap: "1.25rem" }}>
              {/* Inputs */}
              <div>
                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Your Property" />
                  <DualInput label="Current Home Value" value={eqHomeVal} min={50000} max={5000000} step={5000} onChange={setEqHomeVal} prefix="$" integer note="Use Zillow, Redfin, or a recent appraisal. Lender orders their own." />
                  <DualInput label="Primary Mortgage Balance" value={eqMortBal} min={0} max={eqHomeVal} step={1000} onChange={setEqMortBal} prefix="$" integer note="From your latest mortgage statement." />
                  <DualInput label="Other Liens (2nd mortgage, etc.)" value={eqOtherLiens} min={0} max={eqHomeVal} step={1000} onChange={setEqOtherLiens} prefix="$" integer note="Enter 0 if none." />
                </Card>

                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Loan Details" />
                  <DualInput label="Amount to Borrow" value={eqBorrow} min={5000} max={Math.max(5000, eqMaxBorrow85 + 50000)} step={1000} onChange={setEqBorrow} prefix="$" integer />
                  <DualInput label="Interest Rate (APR)" value={eqRate} min={3} max={20} step={0.1} onChange={setEqRate} suffix="%" note={eqType === "heloc" ? "Current HELOC avg ~8.5%. Variable — tied to Prime Rate." : "Current HE Loan avg ~8.35%. Fixed for life."} />
                  {eqType !== "heloc" && <DualInput label="Term" value={eqTerm} min={5} max={30} step={5} onChange={setEqTerm} suffix=" yrs" />}
                </Card>
              </div>

              {/* Results */}
              <div>
                <div style={{ background: `linear-gradient(135deg, #f0fdf4, #dcfce7)`, border: "1px solid #86efac", borderRadius: "13px", padding: "1.5rem", marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.58rem", letterSpacing: "0.15em", textTransform: "uppercase", color: S.muted, marginBottom: "0.2rem" }}>Total Available Equity</div>
                  <div style={{ fontSize: "2.8rem", fontWeight: 800, color: S.green, fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em", lineHeight: 1 }}>{$(eqEquity)}</div>
                  <div style={{ fontSize: "0.67rem", color: S.muted, marginTop: "0.4rem" }}>{$(eqHomeVal)} value − {$(eqMortBal)} mortgage{eqOtherLiens > 0 ? ` − ${$(eqOtherLiens)} other liens` : ""}</div>
                  <div style={{ marginTop: "1rem" }}>
                    <EquityMeter equity={eqEquity} homeValue={eqHomeVal} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.65rem", marginBottom: "1rem" }}>
                  <Stat label="Current LTV" value={pc(eqCurrentLTV * 100)} warn={eqCurrentLTV > 0.9} sub={eqCurrentLTV > 0.8 ? "High — limits equity access" : "Healthy LTV"} />
                  <Stat label="Max Borrowable (80% CLTV)" value={$(eqMaxBorrow80)} sub="Conservative lender limit" />
                  <Stat label="Max Borrowable (85% CLTV)" value={$(eqMaxBorrow85)} sub="Most lenders' hard limit" />
                  <Stat label="CLTV After Loan" value={pc(eqCLTV * 100)} warn={eqCLTV > 0.85} sub={eqCLTV > 0.85 ? "Exceeds 85% limit" : eqCLTV > 0.8 ? "Nearing limit" : "Within range"} />
                </div>

                {eqBorrow > eqMaxBorrow85 && <Alert type="warn">You're trying to borrow {$(eqBorrow)}, but most lenders cap at 85% CLTV. Max available: {$(eqMaxBorrow85)}. Results use capped amount.</Alert>}

                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Loan Cost Summary" />
                  <Row label="Borrowing" value={$(eqSafe)} hi />
                  <Row label="Monthly Payment" value={$2(eqMoPmt)} hi note={eqType === "heloc" ? "Interest-only during draw period" : undefined} />
                  {eqType === "heloc" && <Row label="After Draw Period — P&I Payment" value={$2(calcMP(eqSafe, eqRate, eqTerm * 12))} warn note="Payment jumps when draw period ends — budget for this" />}
                  <Row label="Total Interest" value={$(eqTotInt)} warn />
                  <Row label="Total Repaid" value={$(eqSafe + eqTotInt)} />
                  <Divider />
                  <Row label="Current LTV" value={pc(eqCurrentLTV * 100)} />
                  <Row label="New CLTV" value={pc(eqCLTV * 100)} warn={eqCLTV > 0.85} />
                </Card>

                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="What Different CLTV Targets Allow" />
                  {[
                    { label: "80% CLTV (conservative)", max: eqMaxBorrow80, color: S.green },
                    { label: "85% CLTV (standard max)", max: eqMaxBorrow85, color: S.gold },
                    { label: "90% CLTV (some lenders)", max: Math.max(0, eqHomeVal * 0.90 - eqMortBal - eqOtherLiens), color: S.red },
                  ].map(t => (
                    <div key={t.label} style={{ display: "flex", justifyContent: "space-between", padding: "0.38rem 0", borderBottom: `1px solid ${S.dim}` }}>
                      <span style={{ fontSize: "0.71rem", color: S.muted }}>{t.label}</span>
                      <span style={{ fontSize: "0.8rem", color: t.color, fontFamily: "'DM Mono', monospace", fontWeight: 700 }}>{$(Math.max(0, t.max))}</span>
                    </div>
                  ))}
                  <p style={{ fontSize: "0.62rem", color: S.muted, margin: "0.6rem 0 0", lineHeight: 1.5 }}>90%+ CLTV is rare, usually requires excellent credit (740+) and may carry higher rates. Some lenders stop at 80%.</p>
                </Card>

                {eqType !== "heloc" && eqAmort.length > 0 && (
                  <Card>
                    <SectionHead label="Amortization Schedule" />
                    <AmortTable schedule={eqAmort} view={amortView} setView={setAmortView} />
                  </Card>
                )}
<div style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "1px solid #86efac", borderRadius: "12px", padding: "1.25rem 1.5rem", marginTop: "0.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#0f1f35", marginBottom: "0.2rem" }}>Want to access your equity?</div>
                    <div style={{ fontSize: "0.72rem", color: S.muted }}>Get matched with a loan officer for HELOC, HE Loan, or Cash-Out Refi.</div>
                  </div>
                  <a href="/apply.html" style={{ display: "inline-block", padding: "0.6rem 1.4rem", background: "linear-gradient(135deg,#059669,#34d399)", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "0.82rem", fontWeight: 700, whiteSpace: "nowrap" }}>Apply Now →</a>
                </div>
                <Alert type="tip">Ask every lender: full APR (not just rate), closing costs ($0–$3K), annual fee, prepayment penalty, and rate cap (HELOC). Use at least 3 quotes. Credit unions often beat banks on HELOC rates.</Alert>
              </div>
            </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: DEBT CONSOLIDATION
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "debtcon" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(320px,1.1fr) minmax(320px,1.4fr)", gap: "1.25rem" }}>

              {/* LEFT — Inputs */}
              <div>
                {/* Home info */}
                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Your Home" />
                  <DualInput label="Current Home Value" value={dcHomeVal} min={50000} max={5000000} step={5000} onChange={setDcHomeVal} prefix="$" integer note="Used to calculate available equity for consolidation." />

                  {/* Free & Clear toggle */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.85rem", padding: "0.75rem", background: "#f5f8fc", borderRadius: "8px", border: `1px solid ${S.border}` }}>
                    <div>
                      <div style={{ fontSize: "0.73rem", fontWeight: 700, color: S.text }}>I own my home free &amp; clear</div>
                      <div style={{ fontSize: "0.62rem", color: S.muted, marginTop: "0.15rem" }}>No existing mortgage balance</div>
                    </div>
                    <button onClick={() => setDcFreeClr(v => !v)} style={{ width: "40px", height: "22px", borderRadius: "11px", background: dcFreeClr ? S.green : "#d1d8e0", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                      <div style={{ position: "absolute", top: "3px", left: dcFreeClr ? "21px" : "3px", width: "16px", height: "16px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                    </button>
                  </div>

                  {!dcFreeClr && (
                    <DualInput label="Current Mortgage Balance" value={dcMortBal} min={0} max={dcHomeVal} step={1000} onChange={setDcMortBal} prefix="$" integer note="From your latest mortgage statement. The new loan will replace or sit on top of this." />
                  )}

                  {/* Current mortgage payment */}
                  {!dcFreeClr && (
                    <div style={{ borderTop: `1px solid ${S.dim}`, paddingTop: "1rem", marginTop: "0.25rem" }}>
                      <DualInput
                        label="Current Monthly Mortgage Payment"
                        value={dcMortPmt}
                        min={100}
                        max={20000}
                        step={25}
                        onChange={setDcMortPmt}
                        prefix="$"
                        suffix="/mo"
                        integer
                        note="Enter your actual payment from your bank statement or coupon book."
                      />

                      {/* Escrow checkbox */}
                      <div style={{ background: "#f5f8fc", border: `1px solid ${S.border}`, borderRadius: "8px", padding: "0.85rem 1rem", marginBottom: "0.5rem" }}>
                        <label style={{ display: "flex", alignItems: "flex-start", gap: "0.65rem", cursor: "pointer" }}>
                          <input
                            type="checkbox"
                            checked={dcMortEscrow}
                            onChange={e => setDcMortEscrow(e.target.checked)}
                            style={{ width: "15px", height: "15px", marginTop: "2px", accentColor: S.green, cursor: "pointer", flexShrink: 0 }}
                          />
                          <div>
                            <div style={{ fontSize: "0.73rem", fontWeight: 700, color: S.text, lineHeight: 1.3 }}>
                              My payment includes taxes &amp; insurance (escrow)
                            </div>
                            <div style={{ fontSize: "0.62rem", color: S.muted, marginTop: "0.2rem", lineHeight: 1.4 }}>
                              Check this if your lender collects property tax and homeowners insurance as part of your monthly payment.
                            </div>
                          </div>
                        </label>

                        {dcMortEscrow && (
                          <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: `1px solid ${S.dim}` }}>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.65rem", marginBottom: "0.65rem" }}>
                              <DualInput label="Monthly Tax (escrow)" value={dcMortTax} min={0} max={3000} step={10} onChange={setDcMortTax} prefix="$" suffix="/mo" integer note="Annual tax ÷ 12" />
                              <DualInput label="Monthly Insurance (escrow)" value={dcMortIns} min={0} max={1000} step={10} onChange={setDcMortIns} prefix="$" suffix="/mo" integer note="Annual premium ÷ 12" />
                            </div>
                            {/* Live breakdown */}
                            <div style={{ background: "#eff8ff", border: "1px solid #bae6fd", borderRadius: "7px", padding: "0.7rem 0.85rem" }}>
                              <div style={{ fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.accent, marginBottom: "0.45rem" }}>Payment Breakdown</div>
                              {[
                                { l: "Total payment", v: dcMortPmt },
                                { l: "− Property tax (escrow)", v: dcMortTax },
                                { l: "− Homeowners insurance (escrow)", v: dcMortIns },
                              ].map(r => (
                                <div key={r.l} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: S.muted, marginBottom: "0.2rem" }}>
                                  <span>{r.l}</span>
                                  <span style={{ fontFamily: "'DM Mono',monospace", color: S.text }}>{$2(r.v)}</span>
                                </div>
                              ))}
                              <div style={{ height: "1px", background: "#bae6fd", margin: "0.4rem 0" }} />
                              <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                                <span style={{ fontSize: "0.72rem", color: S.accent }}>P&amp;I only</span>
                                <span style={{ fontSize: "0.85rem", fontFamily: "'DM Mono',monospace", color: S.accent }}>{$2(dcMortPandI)}</span>
                              </div>
                              {dcMortPandI < 0 && (
                                <p style={{ fontSize: "0.62rem", color: S.red, margin: "0.4rem 0 0" }}>⚠ Escrow exceeds payment — check your entries.</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Summary line */}
                      <div style={{ fontSize: "0.67rem", color: S.muted, background: "#f5f8fc", borderRadius: "6px", padding: "0.5rem 0.75rem" }}>
                        Using <strong style={{ color: S.text, fontFamily: "'DM Mono',monospace" }}>{$2(dcMortPmt)}/mo</strong> as your current mortgage payment
                        {dcMortEscrow ? ` (${$2(dcMortPandI)} P&I + ${$2(dcMortEscrowAmt)} escrow)` : ""}
                        {" "}for the monthly total comparison.
                      </div>
                    </div>
                  )}
                  {dcFreeClr && (
                    <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: "7px", padding: "0.6rem 0.85rem", fontSize: "0.68rem", color: "#15803d" }}>
                      ✅ No existing mortgage — 100% of your home value is available equity. Great position for consolidation.
                    </div>
                  )}
                </Card>

                {/* Debts list */}
                <Card style={{ marginBottom: "1rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                    <SectionHead label="Debts to Consolidate" />
                    <button onClick={addDebt} style={{ fontSize: "0.68rem", fontWeight: 700, color: "#fff", background: S.accent, border: "none", borderRadius: "6px", padding: "0.3rem 0.75rem", cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      + Add Debt
                    </button>
                  </div>

                  <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: S.muted, display: "grid", gridTemplateColumns: "1fr 90px 75px 80px 28px", gap: "0.4rem", marginBottom: "0.4rem", padding: "0 0.1rem" }}>
                    <span>Debt Name</span><span style={{ textAlign: "right" }}>Balance</span><span style={{ textAlign: "right" }}>Rate %</span><span style={{ textAlign: "right" }}>Mo. Pmt</span><span />
                  </div>

                  {dcDebts.map((d, i) => (
                    <div key={d.id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 75px 80px 28px", gap: "0.4rem", alignItems: "center", marginBottom: "0.5rem", padding: "0.55rem 0.6rem", background: i % 2 === 0 ? "#f9fbfd" : "#ffffff", border: `1px solid ${S.border}`, borderRadius: "7px" }}>
                      <input
                        value={d.name}
                        onChange={e => updateDebt(d.id, "name", e.target.value)}
                        style={{ background: "transparent", border: "none", outline: "none", fontSize: "0.75rem", color: S.text, fontFamily: "'DM Sans', sans-serif", fontWeight: 500, width: "100%", padding: "0.1rem 0" }}
                        placeholder="Debt name"
                      />
                      {["balance", "rate", "monthly"].map(field => (
                        <input
                          key={field}
                          type="number"
                          value={d[field]}
                          onChange={e => updateDebt(d.id, field, parseFloat(e.target.value) || 0)}
                          style={{ background: "#f5f8fc", border: `1px solid ${S.border}`, borderRadius: "5px", color: S.text, padding: "0.28rem 0.45rem", fontFamily: "'DM Mono', monospace", fontSize: "0.75rem", width: "100%", textAlign: "right", outline: "none" }}
                          min="0"
                          step={field === "rate" ? "0.01" : "1"}
                        />
                      ))}
                      <button onClick={() => removeDebt(d.id)} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "5px", color: S.red, cursor: "pointer", fontWeight: 700, fontSize: "0.75rem", padding: "0.25rem", lineHeight: 1, fontFamily: "inherit" }}>✕</button>
                    </div>
                  ))}

                  {dcDebts.length === 0 && (
                    <div style={{ textAlign: "center", padding: "1.5rem", color: S.muted, fontSize: "0.75rem" }}>No debts added yet. Click "Add Debt" above.</div>
                  )}

                  {/* Totals row */}
                  {dcDebts.length > 0 && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 75px 80px 28px", gap: "0.4rem", alignItems: "center", marginTop: "0.5rem", padding: "0.55rem 0.6rem", background: "#eff8ff", border: "1px solid #bae6fd", borderRadius: "7px" }}>
                      <span style={{ fontSize: "0.7rem", fontWeight: 700, color: S.accent }}>TOTAL ({dcDebts.length} debts)</span>
                      <span style={{ fontSize: "0.75rem", fontWeight: 700, color: S.text, fontFamily: "'DM Mono', monospace", textAlign: "right" }}>{$(dcTotalDebtBal)}</span>
                      <span style={{ fontSize: "0.72rem", color: S.muted, textAlign: "right" }}>{pc(dcWtdAvgRate)}</span>
                      <span style={{ fontSize: "0.75rem", fontWeight: 700, color: S.red, fontFamily: "'DM Mono', monospace", textAlign: "right" }}>{$2(dcTotalMonthly)}</span>
                      <span />
                    </div>
                  )}
                </Card>

                {/* New loan terms */}
                <Card>
                  <SectionHead label="New Consolidation Loan Terms" />
                  <DualInput label="New Interest Rate (APR)" value={dcNewRate} min={2} max={15} step={0.125} onChange={setDcNewRate} suffix="%" note="Cash-out refi: ~6.69%. HE Loan: ~8.35%. Best rates go to 760+ credit scores." />
                  <div style={{ marginBottom: "1rem" }}>
                    <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted, marginBottom: "0.4rem" }}>New Loan Term</div>
                    <Pills value={dcNewTerm} onChange={setDcNewTerm} options={[{ v: 10, l: "10yr" }, { v: 15, l: "15yr" }, { v: 20, l: "20yr" }, { v: 25, l: "25yr" }, { v: 30, l: "30yr" }]} color={S.accent} />
                    {dcNewTerm >= 20 && <p style={{ fontSize: "0.62rem", color: S.gold, marginTop: "0.4rem" }}>⚠ Longer term lowers the payment but you'll pay more interest over time — even at a lower rate. See the interest comparison below.</p>}
                  </div>
                  <DualInput label="Closing Costs %" value={dcClosPct} min={0} max={6} step={0.25} onChange={setDcClosPct} suffix="%" note={`Estimated: ${$(dcClosing)} · Typical: 2–3% of new loan.`} />
                  <div style={{ marginBottom: "0.5rem" }}>
                    <div style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted, marginBottom: "0.4rem" }}>Closing Costs</div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {[{ v: true, l: "Roll into loan" }, { v: false, l: "Pay upfront" }].map(opt => (
                        <button key={String(opt.v)} onClick={() => setDcRollClos(opt.v)} style={{ padding: "0.35rem 0.85rem", borderRadius: "6px", fontFamily: "inherit", border: `1px solid ${dcRollClos === opt.v ? S.accent : "rgba(0,0,0,0.1)"}`, background: dcRollClos === opt.v ? "#eff8ff" : "#f5f8fc", color: dcRollClos === opt.v ? S.accent : S.muted, fontSize: "0.72rem", fontWeight: dcRollClos === opt.v ? 700 : 400, cursor: "pointer", transition: "all 0.12s" }}>{opt.l}</button>
                      ))}
                    </div>
                  </div>
                </Card>
              </div>

              {/* RIGHT — Results */}
              <div>
                {/* Can we cover it? */}
                {dcDebts.length > 0 && (
                  <div style={{ background: dcCanAfford ? "linear-gradient(135deg,#f0fdf4,#dcfce7)" : "linear-gradient(135deg,#fef2f2,#fee2e2)", border: `1px solid ${dcCanAfford ? "#86efac" : "#fca5a5"}`, borderRadius: "13px", padding: "1.5rem", marginBottom: "1rem" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
                      <div>
                        <div style={{ fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: S.muted, marginBottom: "0.2rem" }}>Current Monthly Outgoing</div>
                        <div style={{ fontSize: "2.4rem", fontWeight: 900, color: S.red, fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em", lineHeight: 1 }}>{$2(dcTotalCurrentOut)}</div>
                        <div style={{ fontSize: "0.63rem", color: S.muted, marginTop: "0.3rem", lineHeight: 1.5 }}>
                          {!dcFreeClr && <span style={{ display: "block" }}>{$2(dcMortPmt)}/mo mortgage{dcMortEscrow ? ` (incl. ${$2(dcMortEscrowAmt)} escrow)` : ""}</span>}
                          <span style={{ display: "block" }}>{$2(dcTotalMonthly)}/mo on {dcDebts.length} debt{dcDebts.length !== 1 ? "s" : ""}</span>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.58rem", letterSpacing: "0.14em", textTransform: "uppercase", color: S.muted, marginBottom: "0.2rem" }}>New Consolidated Payment</div>
                        <div style={{ fontSize: "2.4rem", fontWeight: 900, color: S.accent, fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em", lineHeight: 1 }}>{$2(dcNewPmt)}</div>
                        <div style={{ fontSize: "0.63rem", color: S.muted, marginTop: "0.3rem" }}>
                          All debts{!dcFreeClr ? " + mortgage" : ""} rolled into one payment
                        </div>
                      </div>
                    </div>

                    {/* Monthly savings banner */}
                    <div style={{ borderTop: `1px solid ${dcCanAfford ? "#86efac" : "#fca5a5"}`, paddingTop: "0.85rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem" }}>
                      <div>
                        <div style={{ fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: S.muted }}>Monthly Savings</div>
                        <div style={{ fontSize: "1.8rem", fontWeight: 900, color: dcMonthlySavings > 0 ? S.green : S.red, fontFamily: "'DM Mono', monospace" }}>
                          {dcMonthlySavings >= 0 ? "+" : ""}{$2(dcMonthlySavings)}<span style={{ fontSize: "1rem", fontWeight: 400 }}>/mo</span>
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "0.6rem", letterSpacing: "0.12em", textTransform: "uppercase", color: S.muted }}>Annual Savings</div>
                        <div style={{ fontSize: "1.3rem", fontWeight: 800, color: dcMonthlySavings > 0 ? S.green : S.red, fontFamily: "'DM Mono', monospace" }}>
                          {dcMonthlySavings >= 0 ? "+" : ""}{$(dcMonthlySavings * 12)}<span style={{ fontSize: "0.85rem" }}>/yr</span>
                        </div>
                      </div>
                    </div>

                    {!dcCanAfford && (
                      <div style={{ marginTop: "0.75rem", fontSize: "0.7rem", color: "#b91c1c" }}>
                        ⚠ Your total debt ({$(dcTotalDebtBal)}) exceeds the max you can borrow against equity at 80% LTV ({$(dcMaxAvail80)}). You may still qualify for partial consolidation — remove your largest balance debts to see what fits.
                      </div>
                    )}
                  </div>
                )}

                {/* Equity check */}
                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Equity Available for Consolidation" />
                  <div style={{ marginBottom: "0.75rem" }}>
                    <EquityMeter equity={Math.max(0, dcHomeVal - dcMortBalance)} homeValue={dcHomeVal} />
                  </div>
                  <Row label="Home value" value={$(dcHomeVal)} />
                  {!dcFreeClr && <Row label="Current mortgage balance" value={$(dcMortBalance)} />}
                  <Row label="Available equity" value={$(Math.max(0, dcHomeVal - dcMortBalance))} hi />
                  <Divider />
                  <Row label="Max consolidate at 80% LTV" value={$(dcMaxAvail80)} hi note="Most lenders' standard limit" />
                  <Row label="Max consolidate at 85% LTV" value={$(dcMaxAvail85)} note="Some lenders — higher rate likely" />
                  <Row label="Total debt to consolidate" value={$(dcTotalDebtBal)} warn={!dcCanAfford} />
                  <Row label={dcCanAfford ? "✓ Fits within 80% LTV" : "✗ Exceeds 80% LTV limit"} value={dcCanAfford ? `${$(dcMaxAvail80 - dcTotalDebtBal)} to spare` : `${$(dcTotalDebtBal - dcMaxAvail80)} over limit`} warn={!dcCanAfford} hi={dcCanAfford} />
                </Card>

                {/* Debt-by-debt breakdown */}
                {dcDebts.length > 0 && (
                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Current Debt Breakdown" />
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.7rem", minWidth: "440px" }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                            {["Debt", "Balance", "Rate", "Mo. Payment", "Mo. Interest", "Mo. Principal"].map(h => (
                              <th key={h} style={{ textAlign: "right", padding: "0.38rem 0.55rem", color: S.muted, fontSize: "0.57rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dcDebts.map((d, i) => {
                            const moInt = d.balance * d.rate / 100 / 12;
                            const moPrin = Math.max(0, d.monthly - moInt);
                            return (
                              <tr key={d.id} style={{ background: i % 2 ? "#f9fbfd" : "#fff", borderBottom: `1px solid #edf0f5` }}>
                                <td style={{ padding: "0.38rem 0.55rem", color: S.text, fontWeight: 500, textAlign: "right" }}>{d.name}</td>
                                <td style={{ padding: "0.38rem 0.55rem", fontFamily: "'DM Mono',monospace", color: "#374151", textAlign: "right" }}>{$(d.balance)}</td>
                                <td style={{ padding: "0.38rem 0.55rem", fontFamily: "'DM Mono',monospace", color: d.rate > 18 ? S.red : S.gold, textAlign: "right" }}>{pc(d.rate)}</td>
                                <td style={{ padding: "0.38rem 0.55rem", fontFamily: "'DM Mono',monospace", color: "#374151", textAlign: "right" }}>{$2(d.monthly)}</td>
                                <td style={{ padding: "0.38rem 0.55rem", fontFamily: "'DM Mono',monospace", color: S.red, textAlign: "right" }}>{$2(moInt)}</td>
                                <td style={{ padding: "0.38rem 0.55rem", fontFamily: "'DM Mono',monospace", color: S.green, textAlign: "right" }}>{$2(moPrin)}</td>
                              </tr>
                            );
                          })}
                          <tr style={{ background: "#eff8ff", borderTop: `2px solid #bae6fd` }}>
                            <td style={{ padding: "0.45rem 0.55rem", fontWeight: 700, color: S.accent, textAlign: "right" }}>Totals</td>
                            <td style={{ padding: "0.45rem 0.55rem", fontFamily: "'DM Mono',monospace", fontWeight: 700, color: S.text, textAlign: "right" }}>{$(dcTotalDebtBal)}</td>
                            <td style={{ padding: "0.45rem 0.55rem", fontFamily: "'DM Mono',monospace", color: S.muted, textAlign: "right" }}>{pc(dcWtdAvgRate)} avg</td>
                            <td style={{ padding: "0.45rem 0.55rem", fontFamily: "'DM Mono',monospace", fontWeight: 700, color: S.red, textAlign: "right" }}>{$2(dcTotalMonthly)}</td>
                            <td style={{ padding: "0.45rem 0.55rem", fontFamily: "'DM Mono',monospace", fontWeight: 700, color: S.red, textAlign: "right" }}>{$2(dcTotalInterest)}</td>
                            <td style={{ padding: "0.45rem 0.55rem", fontFamily: "'DM Mono',monospace", color: S.green, textAlign: "right" }}>{$2(dcTotalMonthly - dcTotalInterest)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <p style={{ fontSize: "0.62rem", color: S.muted, marginTop: "0.5rem" }}>{$2(dcTotalInterest)}/mo of your {$2(dcTotalMonthly)} is going to interest alone — that's {$2(dcTotalInterest * 12)}/year in interest that could be eliminated.</p>
                  </Card>
                )}

                {/* New loan vs old comparison */}
                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Side-by-Side Comparison" />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0", border: `1px solid ${S.border}`, borderRadius: "8px", overflow: "hidden" }}>
                    {[
                      { label: "Current Situation", bg: "#fff", items: [
                        { l: "# of payments", v: `${dcDebts.length} debt${dcDebts.length !== 1 ? "s" : ""}${!dcFreeClr ? " + mortgage" : ""}` },
                        { l: "Mortgage payment", v: dcFreeClr ? "None (own free & clear)" : $2(dcMortPmt) + "/mo" + (dcMortEscrow ? ` (P&I: ${$2(dcMortPandI)})` : "") },
                        { l: "Total debt payments", v: $2(dcTotalMonthly) + "/mo" },
                        { l: "Total monthly outgoing", v: $2(dcTotalCurrentOut), bold: true, warn: true },
                        { l: "Monthly interest burned", v: $2(dcTotalInterest) + " (debts only)" },
                        { l: "Avg rate on debts", v: pc(dcWtdAvgRate) },
                      ]},
                      { label: "After Consolidation", bg: "#f0fdf4", items: [
                        { l: "# of payments", v: "1 loan" },
                        { l: "Mortgage payment", v: "Included in new loan" },
                        { l: "Debt payments", v: "Paid off at closing" },
                        { l: "New monthly payment", v: $2(dcNewPmt) + "/mo", bold: true, hi: true },
                        { l: "Monthly interest (new loan)", v: $2(dcNewLoan * dcNewRate / 100 / 12) },
                        { l: "New interest rate", v: pc(dcNewRate) },
                      ]},
                    ].map(col => (
                      <div key={col.label} style={{ background: col.bg, padding: "0.85rem" }}>
                        <div style={{ fontSize: "0.6rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted, marginBottom: "0.75rem" }}>{col.label}</div>
                        {col.items.map(item => (
                          <div key={item.l} style={{ marginBottom: "0.5rem" }}>
                            <div style={{ fontSize: "0.59rem", color: S.muted }}>{item.l}</div>
                            <div style={{ fontSize: "0.82rem", fontWeight: item.bold ? 800 : 500, color: item.warn ? S.red : item.hi ? S.green : S.text, fontFamily: "'DM Mono', monospace" }}>{item.v}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>

                  <Divider />
                  <Row label="New loan amount" value={$(dcNewLoan)} />
                  <Row label="New LTV" value={pc(dcNewLTV * 100)} warn={dcNewLTV > 0.85} />
                  <Row label="Closing costs" value={$(dcClosing)} note={dcRollClos ? "Rolled into loan" : "Due at closing"} />
                  <Row label="Total interest on new loan (full term)" value={$(dcNewTotInt)} warn />
                  {dcMonthlySavings > 0 && <Row label="5-year cumulative savings" value={$(dcMonthlySavings * 60)} hi note="vs. current monthly outgoing over 5 years" />}
                </Card>

                {/* Smart alerts */}
                {dcNewTotInt > dcTotalMonthly * dcNewTerm * 12 * 0.5 && dcNewTerm >= 20 && (
                  <Alert type="warn">
                    Stretching to a {dcNewTerm}-year term dramatically increases total interest paid. Consider a 10 or 15-year term — the monthly payment is higher but you save {$(dcNewTotInt - calcTotalInterest(dcNewLoan, dcNewRate, 15 * 12))} in interest vs 15 years.
                  </Alert>
                )}
                {dcNewRate < dcWtdAvgRate && (
                  <Alert type="good">
                    Your new rate ({pc(dcNewRate)}) is significantly lower than your current weighted average debt rate ({pc(dcWtdAvgRate)}). Consolidation makes strong financial sense — you're reducing the rate on {$(dcTotalDebtBal)} in debt.
                  </Alert>
                )}
                {!dcCanAfford && (
                  <Alert type="warn">
                    Your total debt exceeds your available equity at 80% LTV. Options: (1) Pay down some debts first, (2) Use 85% LTV (some lenders allow this), (3) Consolidate only the highest-rate debts that fit within your equity limit.
                  </Alert>
                )}
                <Alert type="tip">
                  <div style={{ background: "linear-gradient(135deg,#eff8ff,#e0f2fe)", border: "1px solid #bae6fd", borderRadius: "12px", padding: "1.25rem 1.5rem", marginTop: "0.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#0f1f35", marginBottom: "0.2rem" }}>Ready to consolidate your debt?</div>
                    <div style={{ fontSize: "0.72rem", color: S.muted }}>Talk to a licensed loan officer about using your equity to simplify your payments.</div>
                  </div>
                  <a href="/apply.html" style={{ display: "inline-block", padding: "0.6rem 1.4rem", background: "linear-gradient(135deg,#0284c7,#0ea5e9)", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "0.82rem", fontWeight: 700, whiteSpace: "nowrap" }}>Apply Now →</a>
                </div>
                  Consolidating into a home loan converts unsecured debt (credit cards) into secured debt (your home). If you fall behind on payments, your home is at risk — a risk that didn't exist with credit cards. Only consolidate if you're committed to not running up the cards again.
                </Alert>

                {/* Amortization */}
                <Card>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: dcShowAmort ? "1rem" : 0 }}>
                    <SectionHead label="New Consolidated Loan Amortization" />
                    <button onClick={() => setDcShowAmort(v => !v)} style={{ fontSize: "0.65rem", color: S.accent, background: "#eff8ff", border: "1px solid #bae6fd", borderRadius: "5px", padding: "0.2rem 0.55rem", cursor: "pointer", fontFamily: "inherit" }}>
                      {dcShowAmort ? "Hide" : `Show all ${dcNewTerm * 12} payments`}
                    </button>
                  </div>
                  {dcShowAmort && <AmortTable schedule={dcAmort} view={amortView} setView={setAmortView} />}
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: DSCR / INVESTOR
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "dscr" && (
          <div>
            <Alert type="tip">DSCR (Debt Service Coverage Ratio) loans qualify based on the property's rental income — no personal income documentation required. DSCR = Gross Rent ÷ PITIA. Most lenders require 1.0–1.25+. May 2026 rates: 6.125–9.125% depending on FICO and LTV.</Alert>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,1fr) minmax(280px,1.3fr)", gap: "1.25rem" }}>
              {/* Inputs */}
              <div>
                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Property & Financing" />
                  <DualInput label="Purchase Price" value={dscrPurchase} min={50000} max={5000000} step={5000} onChange={setDscrPurchase} prefix="$" integer />
                  <DualInput label="Down Payment %" value={dscrDown} min={15} max={50} step={1} onChange={setDscrDown} suffix="%" note="Typical DSCR minimum: 20–25%. Lower LTV = better rate pricing." />
                  <DualInput label="Interest Rate (APR)" value={dscrRate} min={5} max={15} step={0.125} onChange={setDscrRate} suffix="%" note="May 2026 DSCR rates: 6.125–9.125%. 740+ FICO at 75% LTV: ~6.13%." />
                </Card>

                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Rental Income & Expenses" />
                  <DualInput label="Gross Monthly Rent" value={dscrRent} min={0} max={20000} step={50} onChange={setDscrRent} prefix="$" suffix="/mo" note="Use market rent for unfurnished LTR. STR: use conservative avg occupancy." />
                  <DualInput label="Property Tax (monthly)" value={dscrTax} min={0} max={3000} step={25} onChange={setDscrTax} prefix="$" suffix="/mo" note="Included in PITIA for DSCR calculation." />
                  <DualInput label="Insurance (monthly)" value={dscrIns} min={0} max={1000} step={10} onChange={setDscrIns} prefix="$" suffix="/mo" />
                  <DualInput label="HOA (monthly)" value={dscrHOA} min={0} max={2000} step={25} onChange={setDscrHOA} prefix="$" suffix="/mo" note="Enter 0 if none." />
                  <DualInput label="Vacancy Rate" value={dscrVacancy} min={0} max={25} step={0.5} onChange={setDscrVacancy} suffix="%" note="Industry standard: 5–8%. Use realistic local market vacancy." />
                  <DualInput label="Property Management Fee" value={dscrMgmt} min={0} max={20} step={0.5} onChange={setDscrMgmt} suffix="%" note="Typically 8–12% of gross rent. Set 0 if self-managing." />
                </Card>
              </div>

              {/* Results */}
              <div>
                {/* DSCR ratio big number */}
                <div style={{
                  background: dscrRatio >= 1.25 ? "linear-gradient(135deg,#f0fdf4,#dcfce7)" : dscrRatio >= 1.0 ? "linear-gradient(135deg,#fffbeb,#fef3c7)" : "linear-gradient(135deg,#fef2f2,#fee2e2)",
                  border: `1px solid ${dscrRatio >= 1.25 ? "#86efac" : dscrRatio >= 1.0 ? "#fcd34d" : "#fca5a5"}`,
                  borderRadius: "13px", padding: "1.5rem", marginBottom: "1rem"
                }}>
                  <div style={{ fontSize: "0.58rem", letterSpacing: "0.15em", textTransform: "uppercase", color: S.muted, marginBottom: "0.2rem" }}>DSCR Ratio (Lender sees this)</div>
                  <div style={{ fontSize: "3rem", fontWeight: 900, color: dscrRatio >= 1.25 ? S.green : dscrRatio >= 1.0 ? S.gold : S.red, fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em", lineHeight: 1 }}>
                    {dscrRatio.toFixed(3)}x
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "#374151", marginTop: "0.4rem" }}>
                    {dscrRatio >= 1.25 ? "✅ Strong — qualifies with most lenders at best pricing" :
                     dscrRatio >= 1.0  ? "⚠️ Marginal — qualifies at many lenders, expect higher rate" :
                                         "❌ Below 1.0 — won't qualify at most lenders. Consider no-ratio program or increase rent / decrease price."}
                  </div>
                  <div style={{ marginTop: "0.75rem", fontSize: "0.65rem", color: S.muted }}>
                    {$(dscrNetIncome)}/mo net income ÷ {$(dscrPITIA)}/mo PITIA = {dscrRatio.toFixed(3)}x
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "0.65rem", marginBottom: "1rem" }}>
                  <Stat label="Monthly Cash Flow" value={$2(dscrCashflow)} color={dscrCashflow >= 0 ? S.green : S.red} warn={dscrCashflow < 0} sub={dscrCashflow >= 0 ? "Net positive cash flow" : "Cash flow negative"} />
                  <Stat label="PITIA (monthly)" value={$2(dscrPITIA)} sub="P+I+Tax+Ins+HOA" />
                  <Stat label="Annual NOI" value={$(dscrNetIncome * 12)} sub="Net Operating Income" color={S.accent} />
                  <Stat label="Gross Rent Yield" value={pc((dscrRent * 12 / dscrPurchase) * 100)} sub="Annual gross rent / purchase" />
                </div>

                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Income & Expense Breakdown" />
                  <Row label="Gross Monthly Rent" value={$2(dscrGrossRent)} />
                  <Row label={`Vacancy (${dscrVacancy}%)`} value={"−" + $2(dscrRent * dscrVacancy / 100)} warn />
                  <Row label="Effective Gross Income" value={$2(dscrEffRent)} hi />
                  <Row label={`Property Management (${dscrMgmt}%)`} value={"−" + $2(dscrMgmtCost)} warn />
                  <Row label="Net Operating Income" value={$2(dscrNetIncome)} hi />
                  <Divider />
                  <Row label="Mortgage P&I" value={"−" + $2(dscrMoPmt)} />
                  <Row label="Property Tax" value={"−" + $2(dscrTax)} />
                  <Row label="Insurance" value={"−" + $2(dscrIns)} />
                  {dscrHOA > 0 && <Row label="HOA" value={"−" + $2(dscrHOA)} />}
                  <Row label="Total PITIA" value={"−" + $2(dscrPITIA)} hi />
                  <Divider />
                  <Row label="Monthly Cash Flow" value={$2(dscrCashflow)} hi warn={dscrCashflow < 0} />
                  <Row label="Annual Cash Flow" value={$(dscrCashflow * 12)} hi warn={dscrCashflow < 0} />
                </Card>

                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="DSCR Ratio Needed to Qualify" />
                  {[
                    { lender: "Most DSCR lenders", minDSCR: 1.25, note: "Best pricing" },
                    { lender: "Some DSCR lenders", minDSCR: 1.10, note: "Higher rate" },
                    { lender: "Flexible lenders", minDSCR: 1.00, note: "Significantly higher rate" },
                    { lender: "No-ratio DSCR programs", minDSCR: 0.75, note: "Largest down payment required" },
                  ].map(t => (
                    <div key={t.lender} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.38rem 0", borderBottom: `1px solid ${S.dim}` }}>
                      <div>
                        <div style={{ fontSize: "0.71rem", color: S.muted }}>{t.lender}</div>
                        <div style={{ fontSize: "0.6rem", color: "#1a2535" }}>{t.note}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                        <span style={{ fontSize: "0.8rem", color: S.muted, fontFamily: "'DM Mono', monospace" }}>{t.minDSCR.toFixed(2)}x min</span>
                        <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.4rem", borderRadius: "4px", background: dscrRatio >= t.minDSCR ? "#f0fdf4" : "#fef2f2", color: dscrRatio >= t.minDSCR ? S.green : S.red, border: `1px solid ${dscrRatio >= t.minDSCR ? "#86efac" : "#fca5a5"}` }}>
                          {dscrRatio >= t.minDSCR ? "✓ QUALIFY" : "✗ NO"}
                        </span>
                      </div>
                    </div>
                  ))}
                </Card>

                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Rent Needed to Hit DSCR Targets" />
                  {[1.0, 1.10, 1.25, 1.35].map(target => {
                    const mgmtFactor = 1 - dscrMgmt / 100;
                    const vacFactor = 1 - dscrVacancy / 100;
                    const rentNeeded = dscrPITIA * target / (vacFactor * mgmtFactor);
                    return (
                      <Row key={target} label={`${target.toFixed(2)}x DSCR`}
                        value={$2(rentNeeded) + "/mo"}
                        hi={target === 1.25}
                        note={target === 1.25 ? "Most lenders' preferred minimum" : undefined} />
                    );
                  })}
                </Card>

                <Card>
                  <SectionHead label="Amortization" />
                  <AmortTable schedule={dscrAmort} view={amortView} setView={setAmortView} />
                </Card>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            TAB: RATE FINDER
        ══════════════════════════════════════════════════════════════════ */}
        {tab === "finder" && (
          <div style={{ maxWidth: 900, margin: "0 auto" }}>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 800, margin: "0 0 0.35rem" }}>Rate Finder & Payment Breakdown</h2>
            <p style={{ color: S.muted, fontSize: "0.75rem", margin: "0 0 1.5rem" }}>Enter your loan balance, payment, and term to find your implied interest rate. Add tax, insurance, and PMI to see your true total monthly cost — and whether you're paying PMI when you don't need to.</p>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(280px,1fr) minmax(280px,1.2fr)", gap: "1.25rem", marginBottom: "1.25rem" }}>

              {/* LEFT — Inputs */}
              <div>
                <Card style={{ marginBottom: "1rem" }}>
                  <SectionHead label="Your Loan" />
                  <Alert type="tip">Enter three numbers from your mortgage statement. We'll calculate your exact interest rate and show what your payment is really made of.</Alert>
                  <DualInput label="Current Loan Balance" value={rfLoan} min={1000} max={5000000} step={1000} onChange={setRfLoan} prefix="$" integer note="From your latest statement — not the original loan amount." />
                  <DualInput label="Remaining Term" value={rfTerm} min={1} max={40} step={1} onChange={setRfTerm} suffix=" years" note="Years remaining on the loan — not the original term." />

                  {/* Payment input — P&I or total */}
                  <div style={{ borderTop: `1px solid ${S.dim}`, paddingTop: "1rem", marginTop: "0.25rem" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
                      <span style={{ fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.muted }}>My payment includes taxes &amp; insurance</span>
                      <button onClick={() => setRfShowTax(v => !v)} style={{ width: "40px", height: "22px", borderRadius: "11px", background: rfShowTax ? S.green : "#d1d8e0", border: "none", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
                        <div style={{ position: "absolute", top: "3px", left: rfShowTax ? "21px" : "3px", width: "16px", height: "16px", borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                      </button>
                    </div>

                    {!rfShowTax && (
                      <DualInput label="Monthly P&I Payment" value={rfPayment} min={100} max={50000} step={10} onChange={setRfPayment} prefix="$" integer note="Principal & Interest ONLY — do not include tax, insurance, PMI, or HOA." />
                    )}

                    {rfShowTax && (
                      <>
                        <DualInput label="Total Monthly Payment (as paid)" value={rfTotalPmt} min={100} max={50000} step={10} onChange={setRfTotalPmt} prefix="$" integer note="Enter exactly what you pay each month — from your bank statement or coupon book." />
                        <DualInput label="Monthly Property Tax" value={rfTax} min={0} max={3000} step={10} onChange={setRfTax} prefix="$" suffix="/mo" integer note="Annual property tax ÷ 12. From your mortgage statement or county assessor." />
                        <DualInput label="Monthly Homeowners Insurance" value={rfIns} min={0} max={1000} step={10} onChange={setRfIns} prefix="$" suffix="/mo" integer note="Annual insurance premium ÷ 12. From your declarations page." />
                        <DualInput label="HOA Fees" value={rfHOA} min={0} max={2000} step={25} onChange={setRfHOA} prefix="$" suffix="/mo" integer note="Enter 0 if not applicable." />

                        {/* Live P&I extraction */}
                        <div style={{ background: "#eff8ff", border: "1px solid #bae6fd", borderRadius: "8px", padding: "0.8rem 1rem", marginBottom: "1rem" }}>
                          <div style={{ fontSize: "0.58rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.accent, marginBottom: "0.45rem" }}>Extracted P&amp;I (rate calculated from this)</div>
                          {[
                            { l: "Total payment entered",    v: rfTotalPmt, sub: false },
                            { l: "− Property tax",           v: rfTax,      sub: true  },
                            { l: "− Homeowners insurance",   v: rfIns,      sub: true  },
                            { l: "− HOA",                   v: rfHOA,      sub: true  },
                          ].filter(r => r.v > 0 || !r.sub).map(r => (
                            <div key={r.l} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.68rem", color: S.muted, marginBottom: "0.18rem" }}>
                              <span>{r.l}</span>
                              <span style={{ fontFamily: "'DM Mono',monospace", color: S.text }}>{$2(r.v)}</span>
                            </div>
                          ))}
                          <div style={{ height: "1px", background: "#bae6fd", margin: "0.4rem 0" }} />
                          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700 }}>
                            <span style={{ fontSize: "0.72rem", color: S.accent }}>= P&amp;I Only</span>
                            <span style={{ fontSize: "0.88rem", fontFamily: "'DM Mono',monospace", color: S.accent }}>{$2(rfExtractedPI)}</span>
                          </div>
                          {rfExtractedPI < 200 && (
                            <p style={{ fontSize: "0.62rem", color: S.red, margin: "0.4rem 0 0" }}>⚠ Extracted P&I seems too low — double-check your tax and insurance amounts.</p>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </Card>

                {/* Home value & PMI */}
                <Card>
                  <SectionHead label="Home Value & PMI Check" />
                  <DualInput label="Current Home Value" value={rfHomeVal} min={10000} max={5000000} step={5000} onChange={setRfHomeVal} prefix="$" integer note="Used to calculate your LTV and check whether PMI applies. Use Zillow or Redfin for an estimate." />

                  {rfLTV > 0 && rfLTV <= 0.8 && (
                    <Alert type="good">LTV is {pc(rfLTV * 100)} — under 80%. No PMI required on conventional loans. If you're paying PMI, contact your lender — you may be eligible to cancel it.</Alert>
                  )}

                  {rfLTV > 0.8 && rfLTV < 1 && (
                    <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "0.85rem 1rem" }}>
                      <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: S.red, marginBottom: "0.3rem" }}>PMI Likely Applies</div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                        <span style={{ fontSize: "0.71rem", color: "#991b1b" }}>Your LTV</span>
                        <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: S.red, fontSize: "0.82rem" }}>{pc(rfLTV * 100)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                        <span style={{ fontSize: "0.71rem", color: "#991b1b" }}>Est. Monthly PMI</span>
                        <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: S.red, fontSize: "0.82rem" }}>{$2(rfPMI)}/mo</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                        <span style={{ fontSize: "0.71rem", color: "#991b1b" }}>Balance to cancel PMI</span>
                        <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: S.text, fontSize: "0.82rem" }}>{$(rfHomeVal * 0.8)}</span>
                      </div>
                      {rfPMIDropMonth && (
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                          <span style={{ fontSize: "0.71rem", color: "#991b1b" }}>Est. months until PMI cancels</span>
                          <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 700, color: S.text, fontSize: "0.82rem" }}>Month {rfPMIDropMonth}</span>
                        </div>
                      )}
                      <div style={{ fontSize: "0.62rem", color: "#b91c1c", borderTop: "1px solid #fecaca", paddingTop: "0.45rem", lineHeight: 1.5 }}>
                        PMI estimated at 0.85%/yr industry average. Check your mortgage statement for your actual PMI charge. You have the legal right to request PMI cancellation when balance reaches 80% LTV (Homeowners Protection Act).
                      </div>
                    </div>
                  )}
                </Card>
              </div>

              {/* RIGHT — Results */}
              <div>
                {/* Implied rate */}
                <div style={{ background: "linear-gradient(135deg,#eff8ff,#e0f2fe)", border: "1px solid #bae6fd", borderRadius: "13px", padding: "1.5rem", marginBottom: "1rem" }}>
                  <div style={{ fontSize: "0.58rem", letterSpacing: "0.15em", textTransform: "uppercase", color: S.muted, marginBottom: "0.2rem" }}>Implied Interest Rate</div>
                  <div style={{ fontSize: "3rem", fontWeight: 900, color: S.accent, fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em", lineHeight: 1 }}>
                    {foundRate > 0 ? pc(foundRate * 100) : "—"}
                  </div>
                  <div style={{ fontSize: "0.67rem", color: S.muted, marginTop: "0.35rem" }}>
                    {rfShowTax ? "Calculated from extracted P&I, balance, and remaining term" : "APR implied by your balance, payment, and term"}
                  </div>
                  {foundRate > 0 && (
                    <div style={{ marginTop: "0.85rem", paddingTop: "0.85rem", borderTop: "1px solid #bae6fd", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                      <div>
                        <div style={{ fontSize: "0.57rem", textTransform: "uppercase", letterSpacing: "0.1em", color: S.muted }}>Verified P&I</div>
                        <div style={{ fontSize: "1.2rem", fontWeight: 800, color: S.text, fontFamily: "'DM Mono', monospace" }}>{$2(calcMP(rfLoan, foundRate * 100, rfTerm * 12))}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "0.57rem", textTransform: "uppercase", letterSpacing: "0.1em", color: S.muted }}>Interest Remaining</div>
                        <div style={{ fontSize: "1.2rem", fontWeight: 800, color: S.gold, fontFamily: "'DM Mono', monospace" }}>{$(calcTotalInterest(rfLoan, foundRate * 100, rfTerm * 12))}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Total PITI hero */}
                {rfShowTax && foundRate > 0 && (
                  <div style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", border: "1px solid #86efac", borderRadius: "13px", padding: "1.5rem", marginBottom: "1rem" }}>
                    <div style={{ fontSize: "0.58rem", letterSpacing: "0.15em", textTransform: "uppercase", color: S.muted, marginBottom: "0.2rem" }}>
                      Total Monthly All-In
                    </div>
                    <div style={{ fontSize: "3rem", fontWeight: 900, color: S.green, fontFamily: "'DM Mono', monospace", letterSpacing: "-0.03em", lineHeight: 1 }}>{$2(rfTotalPITI)}</div>
                    <div style={{ fontSize: "0.67rem", color: S.muted, marginTop: "0.35rem" }}>P&I + Tax + Insurance{rfPMI > 0 ? " + PMI" : ""}{rfHOA > 0 ? " + HOA" : ""}</div>
                  </div>
                )}

                {foundRate > 0 && (
                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Full Monthly Breakdown" />
                    <Row label="Loan Balance" value={$(rfLoan)} />
                    <Row label="Remaining Term" value={rfTerm + " years (" + rfTerm * 12 + " payments)"} />
                    <Row label="Implied Interest Rate" value={pc(foundRate * 100)} hi />
                    <Divider />
                    <Row label="Monthly P&I" value={$2(rfShowTax ? Math.max(0, rfPayment - rfTax - rfIns - rfHOA) : rfPayment)} hi />
                    {rfShowTax && <>
                      <Row label="Property Tax" value={$2(rfTax) + "/mo"} />
                      <Row label="Homeowners Insurance" value={$2(rfIns) + "/mo"} />
                      {rfHOA > 0 && <Row label="HOA" value={$2(rfHOA) + "/mo"} />}
                      {rfPMI > 0 && <Row label={`PMI (est. — drops mo. ${rfPMIDropMonth || "?"})`} value={$2(rfPMI) + "/mo"} warn note="You have the right to cancel PMI when balance reaches 80% LTV" />}
                      <Divider />
                      <Row label="Total Monthly (PITI+)" value={$2(rfTotalPITI)} hi />
                      <Divider />
                      <Row label="Annual Housing Cost" value={$(rfTotalPITI * 12)} />
                      <Row label="Min. Income (28% front-end DTI)" value={$(rfTotalPITI / 0.28) + "/mo · " + $(rfTotalPITI / 0.28 * 12) + "/yr"} note="Income needed so housing cost is ≤28% of gross income" />
                      <Row label="Min. Income (43% back-end DTI)" value={$(rfTotalPITI / 0.43) + "/mo"} note="Standard conventional back-end DTI limit" />
                    </>}
                    <Divider />
                    <Row label="Total Interest Remaining" value={$(calcTotalInterest(rfLoan, foundRate * 100, rfTerm * 12))} warn />
                    <Row label="Total P+I Remaining" value={$(rfPayment * rfTerm * 12)} />
                    {rfShowTax && <Row label="Total All-In Cost Remaining" value={$(rfTotalPITI * rfTerm * 12)} />}
                    {foundRate * 100 > 7 && <Alert type="tip">Your rate ({pc(foundRate * 100)}) is above current market avg (~6.36% for 30yr). A refinance could potentially save {$(calcTotalInterest(rfLoan, foundRate * 100, rfTerm * 12) - calcTotalInterest(rfLoan, 6.36, rfTerm * 12))} in remaining interest. Use the Equity Calculator tab to model a cash-out refinance.</Alert>}
                    {foundRate * 100 < 3 && <Alert type="warn">Rate seems unusually low — verify your numbers. If your payment includes tax and insurance, toggle on "My payment includes taxes & insurance" on the left.</Alert>}
                  </Card>
                )}

                {rfShowTax && foundRate > 0 && rfTotalPITI > 0 && (
                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Payment Composition" />
                    <PrinIntBar
                      principal={Math.max(0, (rfShowTax ? rfPayment - rfTax - rfIns - rfHOA : rfPayment) - rfLoan * (foundRate / 12))}
                      interest={rfLoan * (foundRate / 12)}
                      pmi={rfPMI}
                      tax={rfTax}
                      ins={rfIns}
                      hoa={rfHOA}
                    />
                  </Card>
                )}

                {rfHomeVal > 0 && (
                  <Card style={{ marginBottom: "1rem" }}>
                    <SectionHead label="Equity & LTV Position" />
                    <EquityMeter equity={Math.max(0, rfHomeVal - rfLoan)} homeValue={rfHomeVal} />
                    <Row label="Home Value" value={$(rfHomeVal)} />
                    <Row label="Loan Balance" value={$(rfLoan)} />
                    <Row label="Current Equity" value={$(Math.max(0, rfHomeVal - rfLoan))} hi />
                    <Row label="LTV Ratio" value={pc(rfLTV * 100)} warn={rfLTV > 0.8} />
                    {rfPMI > 0 && <Row label="Balance to cancel PMI" value={$(rfHomeVal * 0.8)} note="PMI cancels automatically here (Homeowners Protection Act)" />}
                    {rfPMI > 0 && rfPMIDropMonth && <Row label="Est. months until PMI cancels" value={"Month " + rfPMIDropMonth + " (" + (rfPMIDropMonth / 12).toFixed(1) + " yrs)"} hi />}
                    {rfPMI > 0 && <Row label="Total PMI you'll pay until cancellation" value={$(rfPMI * (rfPMIDropMonth || 0))} warn note="This is money that builds no equity" />}
                  </Card>
                )}
              </div>
            </div>

            {/* Rate sensitivity table */}
            <Card style={{ marginBottom: "1.25rem" }}>
              <SectionHead label="Payment at Different Rates (same loan)" />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.71rem", minWidth: "480px" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                      {["Rate", "Monthly P&I", rfShowTax ? "Total PITI+" : "Total Interest", "Total P&I Paid", "vs. Your Rate"].map(h => (
                        <th key={h} style={{ textAlign: "right", padding: "0.4rem 0.6rem", color: S.muted, fontSize: "0.58rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[foundRate > 0 ? foundRate * 100 - 1.0 : 5.0, foundRate > 0 ? foundRate * 100 - 0.5 : 5.5, foundRate > 0 ? foundRate * 100 : 6.0, foundRate > 0 ? foundRate * 100 + 0.5 : 6.5, foundRate > 0 ? foundRate * 100 + 1.0 : 7.0].filter(r => r > 0).map(r => {
                      const pmt      = calcMP(rfLoan, r, rfTerm * 12);
                      const ti       = calcTotalInterest(rfLoan, r, rfTerm * 12);
                      const baseR    = foundRate > 0 ? foundRate * 100 : 6.0;
                      const basePmtV = calcMP(rfLoan, baseR, rfTerm * 12);
                      const isCurrent = Math.abs(r - baseR) < 0.001;
                      const col3     = rfShowTax ? $2(pmt + rfTax + rfIns + rfHOA + rfPMI) : $(ti);
                      return (
                        <tr key={r} style={{ background: isCurrent ? "#eff8ff" : "transparent", borderBottom: `1px solid #edf0f5` }}>
                          <td style={{ padding: "0.38rem 0.6rem", textAlign: "right", color: isCurrent ? S.accent : S.muted, fontFamily: "'DM Mono', monospace", fontWeight: isCurrent ? 700 : 400 }}>{pc(r)}{isCurrent ? " ◀" : ""}</td>
                          <td style={{ padding: "0.38rem 0.6rem", textAlign: "right", color: "#6a88a8", fontFamily: "'DM Mono', monospace" }}>{$2(pmt)}</td>
                          <td style={{ padding: "0.38rem 0.6rem", textAlign: "right", color: rfShowTax ? S.accent : S.gold, fontFamily: "'DM Mono', monospace" }}>{col3}</td>
                          <td style={{ padding: "0.38rem 0.6rem", textAlign: "right", color: "#6a88a8", fontFamily: "'DM Mono', monospace" }}>{$(pmt * rfTerm * 12)}</td>
                          <td style={{ padding: "0.38rem 0.6rem", textAlign: "right", fontFamily: "'DM Mono', monospace", color: isCurrent ? S.muted : pmt < basePmtV ? S.green : S.red, fontSize: "0.69rem" }}>
                            {isCurrent ? "—" : (pmt < basePmtV ? "−" : "+") + $2(Math.abs(pmt - basePmtV)) + "/mo"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Credit score table */}
            <Card>
              <SectionHead label="Credit Score Impact on Rate (30yr Conventional, May 2026)" />
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.71rem", minWidth: "500px" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${S.border}` }}>
                      {["Credit Score", "Typical Rate", "Monthly Pmt", "Total Interest", "vs. Best Rate"].map(h => (
                        <th key={h} style={{ textAlign: "right", padding: "0.4rem 0.6rem", color: S.muted, fontSize: "0.58rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { score: "760+",    rate: 6.20 },
                      { score: "740–759", rate: 6.36 },
                      { score: "720–739", rate: 6.55 },
                      { score: "700–719", rate: 6.80 },
                      { score: "680–699", rate: 7.10 },
                      { score: "660–679", rate: 7.45 },
                      { score: "640–659", rate: 7.95 },
                      { score: "620–639", rate: 8.60 },
                    ].map((r, i) => {
                      const pmt     = calcMP(rfLoan, r.rate, rfTerm * 12);
                      const ti      = calcTotalInterest(rfLoan, r.rate, rfTerm * 12);
                      const bestPmt = calcMP(rfLoan, 6.20, rfTerm * 12);
                      const bestTI  = calcTotalInterest(rfLoan, 6.20, rfTerm * 12);
                      return (
                        <tr key={r.score} style={{ background: i % 2 ? "#f9fbfd" : "#ffffff", borderBottom: `1px solid #edf0f5` }}>
                          <td style={{ padding: "0.38rem 0.6rem", textAlign: "right", color: i === 0 ? S.green : S.muted, fontWeight: i === 0 ? 700 : 400 }}>{r.score}</td>
                          <td style={{ padding: "0.38rem 0.6rem", textAlign: "right", color: "#6a88a8", fontFamily: "'DM Mono', monospace" }}>{pc(r.rate)}</td>
                          <td style={{ padding: "0.38rem 0.6rem", textAlign: "right", color: "#6a88a8", fontFamily: "'DM Mono', monospace" }}>{$2(pmt)}</td>
                          <td style={{ padding: "0.38rem 0.6rem", textAlign: "right", color: S.gold, fontFamily: "'DM Mono', monospace" }}>{$(ti)}</td>
                          <td style={{ padding: "0.38rem 0.6rem", textAlign: "right", color: i === 0 ? S.green : S.red, fontFamily: "'DM Mono', monospace", fontSize: "0.69rem" }}>
                            {i === 0 ? "Best" : "+" + $2(pmt - bestPmt) + "/mo · +" + $(ti - bestTI) + " total"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p style={{ fontSize: "0.62rem", color: S.muted, marginTop: "0.6rem" }}>Based on {$(rfLoan)} loan, {rfTerm}-year term. A 760+ score vs 680 score can save {$(calcTotalInterest(rfLoan, 7.10, rfTerm * 12) - calcTotalInterest(rfLoan, 6.20, rfTerm * 12))} over the life of the loan.</p>
              </div>
            </Card>
          </div>
        )}
      </div>

      {/* Footer Ad */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 1rem" }}>
        <AdUnit slot="ca-pub-9247721766299360" />
      </div>

      {/* Footer */}
      <div style={{ borderTop: `1px solid rgba(0,0,0,0.08)`, padding: "1.25rem 1.5rem", textAlign: "center", background: "#f5f8fc" }}>
        <div style={{ display: "flex", gap: "1.5rem", justifyContent: "center", marginBottom: "0.75rem", flexWrap: "wrap" }}>
          <a href="/about.html"   style={{ fontSize: "0.72rem", color: "#0284c7", textDecoration: "none" }}>About</a>
          <a href="/privacy.html" style={{ fontSize: "0.72rem", color: "#0284c7", textDecoration: "none" }}>Privacy Policy</a>
          <a href="/terms.html"   style={{ fontSize: "0.72rem", color: "#0284c7", textDecoration: "none" }}>Terms of Use</a>
        </div>
        <p style={{ fontSize: "0.6rem", color: "#8a9ab0", margin: 0, lineHeight: 1.7, maxWidth: 800, marginInline: "auto" }}>
          <div style={{ background: "linear-gradient(135deg,#eff8ff,#e0f2fe)", border: "1px solid #bae6fd", borderRadius: "12px", padding: "1.25rem 1.5rem", marginTop: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#0f1f35", marginBottom: "0.2rem" }}>Ready to move forward?</div>
                    <div style={{ fontSize: "0.72rem", color: S.muted }}>Talk to a licensed loan officer — no credit pull, no obligation.</div>
                  </div>
                  <a href="/apply.html" style={{ display: "inline-block", padding: "0.6rem 1.4rem", background: "linear-gradient(135deg,#0284c7,#0ea5e9)", color: "#fff", borderRadius: "8px", textDecoration: "none", fontSize: "0.82rem", fontWeight: 700, whiteSpace: "nowrap" }}>Apply Now →</a>
                </div>
          <strong style={{ color: "#374151" }}>Disclosure:</strong> All calculations are estimates for educational purposes only and do not constitute financial, legal, or lending advice. Market rates sourced from Freddie Mac PMMS, Bankrate, and industry publications as of {MARKET_RATES.updated}. Actual rates and terms are determined by lenders based on your creditworthiness, income, DTI, and other factors. Consult a licensed financial advisor or HUD-approved housing counselor (1-800-569-4287) before any borrowing decision.
          <br />HUD Counseling: 1-800-569-4287 · CFPB: consumerfinance.gov/complaint · Student Aid: studentaid.gov · VA: va.gov
        </p>
        <Analytics />
      </div>
    </div>
  );
}
