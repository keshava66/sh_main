import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRBAC } from '../../context/RBACContext';
import ReactDOM from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { apiJson, apiFetch } from '../../utils/apiClient';

import searchIcon from "/icons/JJ_Icon_Search_RGB.svg";
import closeIcon from "/icons/JJ_Icon_Close.svg";
import downloadIcon from "/icons/JJ_Icon_Download_PDF_RGB.svg";
import databaseIcon from "/icons/JJ_Icon_Database_RGB.svg";
import chevronRightIcon from "/icons/JJ_Icon_Chevron_Right.svg";
import alertIcon from "/icons/JJ_Icon_Alert_RGB.svg";
import filterIcon from "/icons/JJ_Icon_Filter.svg";
import dataVizIcon from "/icons/JJ_Icon_Data_Visualization.svg";

// Virtual Regulator -> External -> Cortellis. Talks only to /api/cortellis (cortellis.py).
// Kept on its own so Cortellis changes don't touch the other explorers, but it
// borrows the External look (filter rail, KPI band, cards, drawer) so it
// doesn't feel like a different app.
// Which columns become charts / grid columns is set per table in cortellis.py
// (TABLES), this page draws whatever /meta and /overview send back.
// URL: ?ct=<table id>, tab comes from the page header (vrtab explore / table).

const TINTS = { red: "url(#jj-red-tint)", ink: "url(#jj-ink-tint)", gray: "url(#jj-gray-tint)", white: "url(#jj-white-tint)" };
const Icon = ({ src, alt = "", className = "w-4 h-4", tint = "red" }) => (
  <img src={src} alt={alt} className={className} style={tint ? { filter: TINTS[tint] } : undefined} />
);

// one colour per facet card, stack colours for the year chart
const PALETTE = ['#eb1700', '#0f68b2', '#2a7a12', '#7d33b0', '#c94f00', '#00706a', '#9e0000', '#004685'];
const STACK = ['#eb1700', '#0f68b2', '#2a7a12', '#7d33b0', '#c94f00', '#00706a', '#9e0000', '#004685'];
const OTHER_COLOR = '#a39992';
const PAGE_SIZES = [25, 50, 100, 200];
const THIS_YEAR = new Date().getFullYear();
const PERIODS = [
  { id: 'all', label: 'All', years: null },
  { id: '10y', label: '10y', years: [THIS_YEAR - 9, THIS_YEAR] },
  { id: '5y', label: '5y', years: [THIS_YEAR - 4, THIS_YEAR] },
  { id: '1y', label: '1y', years: [THIS_YEAR, THIS_YEAR] },
];

const btn = "flex items-center gap-[7px] px-[13px] py-1.5 rounded-full border border-jj-gray-03 text-[11.5px] font-johnson-text text-jj-gray-08 disabled:opacity-40 hover:bg-jj-gray-01 whitespace-nowrap transition-colors";

const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString());
const compact = (n) => (n == null ? '—' : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const isEmpty = (v) => v == null || v === '';
const show = (v) => (isEmpty(v) ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const isUrl = (v) => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim());
const looksLikeDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(v);
const niceCol = (c) => c.replace(/^trailInfo_/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\b\w/g, x => x.toUpperCase());

function fmtDate(v, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!v) return '';
  const d = new Date(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00` : v);
  return isNaN(d) ? String(v) : d.toLocaleDateString('en-US', opts);
}

function daysAgo(v) {
  const d = new Date(v);
  if (isNaN(d)) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function toCsv(columns, rows) {
  const esc = (v) => { const s = show(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [columns.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n');
}

function highlight(text, q) {
  if (!q || !text) return text;
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text).split(new RegExp(`(${safe})`, 'ig')).map((p, i) =>
    p.toLowerCase() === q.toLowerCase() ? <mark key={i} className="bg-jj-yellow-01/70 text-inherit rounded-sm">{p}</mark> : p
  );
}

function useDebounced(value, ms = 400) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function useElementWidth() {
  const [width, setWidth] = useState(0);
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(e => setWidth(e[0].contentRect.width));
    ro.observe(ref.current);
    setWidth(ref.current.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [width, ref];
}

// same dark tooltip as the other explorers
function useChartTip() {
  const [tip, setTip] = useState(null);
  const show = (e, rows) => setTip({ x: e.clientX, y: e.clientY, rows });
  const hide = () => setTip(null);
  // a scroll moves the chart away from a fixed tooltip, so drop it
  const open = !!tip;
  useEffect(() => {
    if (!open) return;
    const off = () => setTip(null);
    window.addEventListener('scroll', off, true);
    window.addEventListener('resize', off);
    return () => { window.removeEventListener('scroll', off, true); window.removeEventListener('resize', off); };
  }, [open]);
  const node = tip ? ReactDOM.createPortal(
    <div
      className="fixed z-[60] pointer-events-none rounded-xl bg-white/95 backdrop-blur border border-jj-gray-02 text-jj-gray-08 shadow-[0_10px_30px_rgba(49,44,42,.14)] px-3 py-2"
      style={{
        left: Math.max(8, Math.min(tip.x + 14, window.innerWidth - 280)),
        top: (() => {
          const est = tip.rows.length * 20 + 16;
          return tip.y + 14 + est > window.innerHeight ? Math.max(8, tip.y - est - 10) : tip.y + 14;
        })(),
      }}
    >
      {tip.rows.map((r, i) => r.header ? (
        <div key={i} className="text-[11.5px] font-johnson-text font-bold mb-1 whitespace-nowrap max-w-[250px] truncate text-jj-gray-08">{r.label}</div>
      ) : (
        <div key={i} className="flex items-center gap-2 text-[11px] font-johnson-text whitespace-nowrap leading-relaxed">
          {r.color && <span className="w-2 h-2 rounded-[2px] flex-shrink-0" style={{ background: r.color }} />}
          <span className="text-jj-gray-07 max-w-[170px] truncate">{r.label}</span>
          <span className="ml-auto pl-4 tabular-nums font-medium">{r.value}</span>
        </div>
      ))}
    </div>,
    document.body
  ) : null;
  return { show, hide, node };
}

// URL state. ct table, cttab section, ctf filters (JSON), ctq search, cty years,
// ctp / cts / ctn records page, sort ("col" or "-col"), page size
const CT_VIEW_KEYS = ['ctf', 'ctq', 'cty', 'ctp', 'cts', 'ctn'];

function readFilters(raw) {
  try {
    const f = JSON.parse(raw || '{}');
    if (!f || typeof f !== 'object' || Array.isArray(f)) return {};
    return Object.fromEntries(Object.entries(f).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => [k, v.map(String)]));
  } catch { return {}; }
}

function readYears(raw) {
  const m = /^(\d{4})-(\d{4})$/.exec(raw || '');
  if (!m) return null;
  const a = +m[1], b = +m[2];
  return a <= b ? [a, b] : [b, a];
}

// same query string for /overview and /table
function filterParams({ filters, q, years }) {
  const p = new URLSearchParams();
  const f = Object.fromEntries(Object.entries(filters).filter(([, v]) => v.length));
  if (Object.keys(f).length) p.set('filters', JSON.stringify(f));
  if (q) p.set('q', q);
  if (years) p.set('years', `${years[0]}-${years[1]}`);
  return p;
}

/* ============================== small pieces ============================== */

// a render bug in here shouldn't blank the whole Unstructured page
class CortellisBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Cortellis crashed', error, info?.componentStack); }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md text-center bg-white border border-jj-gray-02 rounded-[16px] px-8 py-8 shadow-[0_1px_3px_rgba(49,44,42,.06)]">
          <div className="text-[15px] font-johnson-text font-bold text-jj-gray-08">Something went wrong showing Cortellis</div>
          <div className="text-[12px] font-johnson-text text-jj-gray-07 mt-1.5 break-words">{String(this.state.error?.message || this.state.error)}</div>
          <div className="flex items-center justify-center gap-2 mt-4">
            <button onClick={() => this.setState({ error: null })} className="px-4 py-2 rounded-full bg-jj-red text-white text-[12.5px] font-johnson-text font-medium hover:bg-[#c91400]">Try again</button>
            {this.props.onHome && <button onClick={() => { this.setState({ error: null }); this.props.onHome(); }} className="px-4 py-2 rounded-full border border-jj-gray-03 text-[12.5px] font-johnson-text text-jj-gray-08 hover:bg-jj-gray-01">All tables</button>}
          </div>
        </div>
      </div>
    );
  }
}

const STYLES = `
@keyframes ct-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes ct-shine { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@keyframes ct-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
.ct-rise { animation: ct-rise .4s cubic-bezier(.2,.7,.3,1) both; }
.ct-dots { background-image: radial-gradient(rgba(49,44,42,.07) 1px, transparent 1px); background-size: 14px 14px; }
.ct-shimmer { background: linear-gradient(90deg, #ece8e4 30%, #f9f8f7 50%, #ece8e4 70%); background-size: 200% 100%; animation: ct-shine 1.6s linear infinite; }
/* scrollbar look comes from the explorer-wide ue-scrollbars style */
.ct-noscroll { scrollbar-width: none; } .ct-noscroll::-webkit-scrollbar { display: none; }
/* reduce motion (also Windows 'animation effects' off): no sweep, slow fade so it still reads as loading */
@media (prefers-reduced-motion: reduce) { .ct-rise { animation: none; } .ct-shimmer { animation: ct-pulse 1.8s ease-in-out infinite; } }
`;

// /api/cortellis sends NDJSON, one line per finished piece (counts, charts,
// grid rows...). onPart gets everything so far each time a line lands, so the
// page fills in as data arrives. "rows+" keys append, like the backend.
async function apiStream(path, onPart, signal) {
  const res = await apiFetch(path, { signal });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch { /* not json */ }
    throw new Error(detail);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', acc = {};
  const take = (line) => {
    if (!line.trim()) return;
    const part = JSON.parse(line);
    if (part.error) throw new Error(part.error);
    acc = { ...acc };
    for (const [k, v] of Object.entries(part)) {
      if (k.endsWith('+')) acc[k.slice(0, -1)] = [...(acc[k.slice(0, -1)] || []), ...v];
      else acc[k] = v;
    }
    onPart(acc);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1); }
  }
  take(buf);
  return acc;
}
const isAbort = (e) => e?.name === 'AbortError';

// grey bars standing in for text while something loads
function Bar({ w = '100%', h = 10, className = '' }) {
  return <div className={`ct-shimmer rounded-full flex-shrink-0 ${className}`} style={{ width: w, height: h }} />;
}
function SkelCard({ height = 300, lines = 0, className = '' }) {
  return (
    <div className={`rounded-[16px] bg-white border border-jj-gray-02 shadow-[0_1px_3px_rgba(49,44,42,.05)] px-5 py-4 flex flex-col gap-2.5 min-w-0 ${className}`}
      style={{ height }} role="status" aria-label="Loading">
      <Bar w="40%" h={13} />
      <Bar w="62%" h={9} />
      {lines
        ? <div className="flex flex-col gap-3 mt-3">{Array.from({ length: lines }).map((_, i) => <Bar key={i} w={`${94 - ((i * 17) % 38)}%`} h={10} />)}</div>
        : <div className="ct-shimmer flex-1 rounded-xl mt-2" />}
    </div>
  );
}

function RefreshBar({ on }) {
  if (!on) return <div className="flex-shrink-0 h-[3px]" />;
  return (
    <div className="flex-shrink-0 h-[3px] bg-jj-red/15 overflow-hidden" role="status" aria-label="Loading">
      <div className="h-full w-full bg-jj-red animate-pulse" />
    </div>
  );
}

function LoadFailed({ what, error, onRetry }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-jj-maroon-05 text-jj-maroon-05 text-sm font-johnson-text">
      <Icon src={alertIcon} className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 min-w-0 break-words">Couldn't load {what}: {error}</span>
      {onRetry && <button onClick={onRetry} className="flex-shrink-0 text-xs text-jj-blue-03 underline">Retry</button>}
    </div>
  );
}

function Card({ className = '', children }) {
  return <div className={`bg-white border border-jj-gray-02 rounded-[16px] shadow-[0_1px_2px_rgba(49,44,42,.04),0_4px_14px_rgba(49,44,42,.03)] ${className}`}>{children}</div>;
}

// light segmented toggle: white thumb, red text
function Segmented({ value, onChange, options, size = 'md', full }) {
  return (
    <div className={`${full ? 'flex' : 'inline-flex'} bg-[#ece9e6] rounded-full p-[3px] gap-0.5`}>
      {options.map(([id, label]) => (
        <button key={String(id)} onClick={() => onChange(id)}
          className={`${full ? 'flex-1' : ''} rounded-full font-johnson-text transition-all ${size === 'sm' ? 'px-3 py-[3px] text-[10.5px]' : 'px-3 py-[4px] text-[11px]'} ${value === id
            ? 'bg-white text-jj-red font-medium shadow-[0_1px_3px_rgba(49,44,42,.12)]' : 'text-jj-gray-07 hover:text-jj-gray-08'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function CardTitle({ title, sub, right }) {
  return (
    <>
      <div className="flex items-center justify-between mb-1 gap-2">
        <div className="text-[14px] font-johnson-text font-bold text-jj-gray-08 truncate">{title}</div>
        {right}
      </div>
      {sub && <div className="text-[11px] font-johnson-text text-jj-gray-06 mb-3">{sub}</div>}
    </>
  );
}

function Pill({ children, color = '#81766f', title }) {
  return (
    <span title={title} className="inline-flex items-center gap-[5px] max-w-full text-[11.5px] font-johnson-text font-bold px-[9px] py-[3px] rounded-full whitespace-nowrap"
      style={{ background: `${color}14`, color, boxShadow: `inset 0 0 0 1px ${color}40` }}>
      <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="truncate">{children}</span>
    </span>
  );
}

function Delta({ now, prev }) {
  if (prev == null || (now === 0 && prev === 0)) return null;
  const diff = now - prev;
  if (diff === 0) return <span className="text-jj-gray-06">flat vs prior 12 months</span>;
  return (
    <span className={diff > 0 ? 'text-jj-green-03 font-medium' : 'text-jj-maroon-05 font-medium'}>
      {diff > 0 ? '▲' : '▼'} {fmtNum(Math.abs(diff))} <span className="text-jj-gray-06 font-normal">vs prior 12 months</span>
    </span>
  );
}

function Empty({ title, sub, action, onAction }) {
  return (
    <Card className="px-5 py-10 text-center">
      <div className="text-[13px] font-johnson-text font-bold text-jj-gray-08">{title}</div>
      {sub && <div className="text-xs font-johnson-text text-jj-gray-07 mt-1">{sub}</div>}
      {onAction && <button onClick={onAction} className="mt-3 text-xs font-johnson-text text-jj-blue-03 underline">{action}</button>}
    </Card>
  );
}

/* ============================== charts ============================== */

// soft fill for bars: light at the start, full colour at the end
const barFill = (c) => c;

// label + count on top, thin bar below, click to filter
function RankedBars({ rows, active = [], onPick, color, total, unit = 'Records', empty, rank }) {
  const tip = useChartTip();
  const max = Math.max(1, ...rows.map(r => r.count));
  if (!rows.length) return <div className="text-xs font-johnson-text text-jj-gray-07 py-8 text-center">{empty || 'No data for current filters.'}</div>;
  return (
    <div className="flex flex-col gap-[9px]">
      {rows.map((r, i) => {
        const on = active.includes(r.value);
        const c = r.color || color;
        return (
          <div
            key={r.value}
            role="button"
            tabIndex={0}
            onClick={() => onPick?.(r.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick?.(r.value); } }}
            onMouseMove={(e) => tip.show(e, [{ label: r.value, header: true }, { label: unit, value: fmtNum(r.count), color: c },
              ...(total ? [{ label: 'Share', value: `${pct(r.count, total)}%` }] : []),
              ...(onPick ? [{ label: on ? 'Click to remove filter' : 'Click to filter', value: '' }] : [])])}
            onMouseLeave={tip.hide}
            className={`group flex items-center gap-2.5 rounded-lg -mx-1.5 px-1.5 py-[3px] cursor-pointer hover:bg-[#faf9f8] focus:outline-none focus-visible:ring-2 focus-visible:ring-jj-blue-03/30 transition-opacity ${active.length && !on ? 'opacity-60' : ''}`}
          >
            {rank && (
              <span className="w-[22px] h-[22px] rounded-full flex-shrink-0 flex items-center justify-center text-[10.5px] font-johnson-text font-bold tabular-nums"
                style={{ background: i < 3 ? `${c}1a` : '#f6f4f2', color: i < 3 ? c : '#81766f' }}>{i + 1}</span>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-[11.5px] font-johnson-text mb-[4px] gap-2">
                <span className={`truncate text-jj-gray-08 ${on ? 'font-bold' : ''}`} title={r.value}>{r.value}</span>
                <span className="text-jj-gray-07 tabular-nums flex-shrink-0">
                  {fmtNum(r.count)}{total ? <span className="text-jj-gray-06 ml-1.5">{pct(r.count, total)}%</span> : null}
                </span>
              </div>
              <div className="h-[8px] rounded-full bg-[#ece9e6] overflow-hidden">
                <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${(r.count / max) * 100}%`, minWidth: 4, background: barFill(c) }} />
              </div>
            </div>
          </div>
        );
      })}
      {tip.node}
    </div>
  );
}

// ring chart + legend. size grows on the big mix card
function DonutCard({ values, total, active = [], onPick, colors, centerLabel = 'records', size = 132, big }) {
  const tip = useChartTip();
  const SW = big ? 22 : 16, R = size / 2 - SW / 2 - 4, C = 2 * Math.PI * R, mid = size / 2;
  const shown = values.slice(0, big ? 7 : 6);
  const rest = total - shown.reduce((a, v) => a + v.count, 0);
  const segs = [...shown.map((v, i) => ({ ...v, color: colors[i % colors.length] })), ...(rest > 0 ? [{ value: 'Other', count: rest, color: OTHER_COLOR, other: true }] : [])];
  const sum = segs.reduce((a, s) => a + s.count, 0) || 1;
  let off = 0;
  return (
    <div className={`flex items-center min-w-0 ${big ? 'flex-col gap-5 2xl:flex-row 2xl:gap-6' : 'gap-5'}`}>
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={mid} cy={mid} r={R} fill="none" stroke="#ece9e6" strokeWidth={SW} />
          {segs.map(s => {
            const len = (s.count / sum) * C;
            const on = active.includes(s.value);
            const el = (
              <circle key={s.value} cx={mid} cy={mid} r={R} fill="none" stroke={s.color} strokeWidth={on ? SW + 5 : SW}
                strokeDasharray={`${Math.max(0, len - 2.5)} ${C}`} strokeDashoffset={-off}
                opacity={active.length && !on ? 0.35 : 1}
                style={{ cursor: s.other ? 'default' : 'pointer', transition: 'stroke-width .2s, opacity .2s' }}
                onClick={() => !s.other && onPick?.(s.value)}
                onMouseMove={(e) => tip.show(e, [{ label: s.value, header: true }, { label: 'Records', value: fmtNum(s.count), color: s.color }, { label: 'Share', value: `${pct(s.count, total)}%` }])}
                onMouseLeave={tip.hide} />
            );
            off += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className={`font-johnson-display font-bold leading-none text-jj-gray-08 tabular-nums ${big ? 'text-[26px]' : 'text-[20px]'}`}>{compact(total)}</div>
          <div className="text-[10.5px] font-johnson-text uppercase tracking-wider text-jj-gray-07 mt-1">{centerLabel}</div>
        </div>
      </div>
      <div className={`min-w-0 flex flex-col ${big ? 'w-full gap-1.5' : 'flex-1 gap-1'}`}>
        {segs.map(s => {
          const on = active.includes(s.value);
          return (
            <button key={s.value} disabled={s.other} onClick={() => onPick?.(s.value)} title={`${s.value}: ${fmtNum(s.count)}`}
              className={`flex items-center gap-2.5 text-left rounded-lg px-2 py-[5px] -mx-2 hover:bg-[#faf9f8] disabled:hover:bg-transparent disabled:cursor-default transition-opacity ${active.length && !on ? 'opacity-60' : ''}`}>
              <span className="w-3 h-3 rounded-[4px] flex-shrink-0" style={{ background: s.color }} />
              <span className={`flex-1 min-w-0 truncate text-[12.5px] font-johnson-text text-jj-gray-08 ${on ? 'font-bold' : ''}`}>{s.value}</span>
              {big && <span className="text-[11.5px] font-johnson-text text-jj-gray-07 tabular-nums">{compact(s.count)}</span>}
              <span className="w-[38px] text-right text-[12px] font-johnson-text font-bold text-jj-gray-08 tabular-nums">{pct(s.count, total)}%</span>
            </button>
          );
        })}
      </div>
      {tip.node}
    </div>
  );
}

// smooth line through points, used by the KPI sparkline
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const mx = (x0 + x1) / 2;
    d += ` C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }
  return d;
}

// Drop the long thin tails so the years that matter get the width:
// nothing after this year (planned / bad dates), and leading years that
// together hold under 1% of records. Always keep at least 8 years.
function trimTrend(trend) {
  const past = trend.filter(t => t.year <= THIS_YEAR);
  const future = trend.filter(t => t.year > THIS_YEAR).reduce((a, t) => a + t.count, 0);
  const total = past.reduce((a, t) => a + t.count, 0);
  let start = 0, acc = 0;
  while (start < past.length - 8 && acc + past[start].count < total * 0.01) { acc += past[start].count; start++; }
  return { rows: past.slice(start), before: acc, beforeYear: past[start]?.year, future };
}

// records per year as stacked columns (by the top values of one facet) or plain totals
function YearActivity({ trend, stack, years, onPickYear, height = 250, title, sub, valueColor }) {
  const tip = useChartTip();
  const [w, ref] = useElementWidth();
  const [mode, setMode] = useState('stack');
  const [hover, setHover] = useState(null);
  const order = stack?.values?.length ? stack.values : [];
  const stacked = mode === 'stack' && order.length > 0;
  const colorOf = (v) => (v === 'Other' ? OTHER_COLOR : valueColor?.(v) || STACK[order.indexOf(v) % STACK.length]);

  const { rows, before, beforeYear, future } = useMemo(() => trimTrend(trend), [trend]);
  const buckets = useMemo(() => {
    if (!rows.length) return [];
    const first = rows[0].year, last = rows[rows.length - 1].year;
    const by = new Map(rows.map(t => [t.year, t]));
    return Array.from({ length: last - first + 1 }, (_, i) => by.get(first + i) || { year: first + i, count: 0, by: {} });
  }, [rows]);

  const H = height, padL = 46, padR = 8, padB = 26, padT = 14;
  const innerW = Math.max(120, w - padL - padR);
  const max = Math.max(1, ...buckets.map(b => b.count));
  const nice = (() => { const p = 10 ** Math.floor(Math.log10(max)); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; })();
  const ticks = [0, nice / 4, nice / 2, (3 * nice) / 4, nice];
  const y = (v) => padT + (H - padT - padB) * (1 - v / nice);
  const slot = buckets.length ? innerW / buckets.length : innerW;
  const barW = Math.max(3, Math.min(34, slot * 0.7));
  const every = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(innerW / 48))));
  const inRange = (yr) => !years || (yr >= years[0] && yr <= years[1]);
  const partial = buckets.length && buckets[buckets.length - 1].year === THIS_YEAR;

  return (
    <div ref={ref}>
      {title && (
        <CardTitle title={title} sub={sub} right={(order.length > 0 || years) && (
          <div className="flex items-center gap-3 flex-shrink-0">
            {years && <button onClick={() => onPickYear(null)} className="text-[11.5px] font-johnson-text text-jj-blue-03 underline whitespace-nowrap">All years</button>}
            {order.length > 0 && <Segmented size="sm" value={mode} onChange={setMode} options={[['stack', 'Stacked'], ['total', 'Total']]} />}
          </div>
        )} />
      )}
      {!buckets.length ? (
        <div className="text-[12px] font-johnson-text text-jj-gray-07 flex items-center justify-center" style={{ height: H }}>No dated records for current filters.</div>
      ) : w > 0 && (
        <svg width={w} height={H} className="block select-none" onMouseLeave={() => { setHover(null); tip.hide(); }}>
          {ticks.map(t => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#cbc4bc' : '#ece9e6'} />
              <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" fill="#6e6259" style={{ fontSize: 10.5 }}>{compact(t)}</text>
            </g>
          ))}
          {buckets.map((b, i) => {
            const cx = padL + slot * i + slot / 2;
            const isPartial = partial && i === buckets.length - 1;
            const single = years && years[0] === b.year && years[1] === b.year;
            const layers = stacked ? order.filter(v => b.by[v]) : (b.count ? ['__total'] : []);
            let acc = 0;
            const tipRows = [
              { label: `${b.year}${isPartial ? ' (so far)' : ''}`, header: true },
              ...(stacked ? order.filter(v => b.by[v]).map(v => ({ label: v, value: fmtNum(b.by[v]), color: colorOf(v) })) : []),
              { label: 'Total', value: fmtNum(b.count) },
              { label: single ? 'Click to show all years' : 'Click to focus this year', value: '' },
            ];
            return (
              <g key={b.year} style={{ cursor: 'pointer' }}
                onMouseMove={(e) => { setHover(i); tip.show(e, tipRows); }}
                onClick={() => onPickYear(single ? null : [b.year, b.year])}
                opacity={(inRange(b.year) ? 1 : 0.3) * (isPartial ? 0.55 : 1)}>
                <rect x={cx - slot / 2} y={padT} width={slot} height={H - padT - padB} fill={hover === i ? '#0f68b2' : 'transparent'} opacity={0.06} rx={4} />
                {layers.map((v, li) => {
                  const val = v === '__total' ? b.count : b.by[v];
                  const y1 = y(acc + val), y0 = y(acc);
                  acc += val;
                  const top = li === layers.length - 1;
                  const h = Math.max(1, y0 - y1 - (top ? 0 : 1));
                  const r = top ? Math.min(3, barW / 3, h) : 0;
                  // rounded top only on the last segment
                  return top && r > 0 ? (
                    <path key={v} fill={v === '__total' ? '#eb1700' : colorOf(v)}
                      d={`M${cx - barW / 2},${y0} V${y1 + r} Q${cx - barW / 2},${y1} ${cx - barW / 2 + r},${y1} H${cx + barW / 2 - r} Q${cx + barW / 2},${y1} ${cx + barW / 2},${y1 + r} V${y0} Z`} />
                  ) : (
                    <rect key={v} x={cx - barW / 2} y={y1} width={barW} height={h} fill={v === '__total' ? '#eb1700' : colorOf(v)} />
                  );
                })}
                {isPartial && b.count > 0 && (
                  <text x={cx} y={y(b.count) - 5} textAnchor="middle" fill="#6e6259" style={{ fontSize: 9.5 }}>so far</text>
                )}
                {i % every === 0 && (
                  <text x={cx} y={H - 8} textAnchor="middle" fill={hover === i ? '#312c2a' : '#4f4743'} style={{ fontSize: 10.5, fontWeight: hover === i ? 700 : 400 }}>{b.year}</text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 mt-2.5">
        {stacked && stack?.column ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 min-w-0">
            {order.map(v => (
              <span key={v} className="inline-flex items-center gap-1.5 text-[11.5px] font-johnson-text text-jj-gray-08 max-w-[220px]">
                <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ background: colorOf(v) }} /><span className="truncate">{v}</span>
              </span>
            ))}
          </div>
        ) : <span />}
        {(before > 0 || future > 0) && (
          <span className="text-[11px] font-johnson-text text-jj-gray-07 whitespace-nowrap">
            {before > 0 && <>{fmtNum(before)} before {beforeYear}</>}
            {before > 0 && future > 0 && ' · '}
            {future > 0 && <>{fmtNum(future)} dated after {THIS_YEAR}</>}
            {' '}not shown
          </span>
        )}
      </div>
      {tip.node}
    </div>
  );
}

// tiny trend line for the KPI tile
function Sparkline({ values, color = '#eb1700', width = 120, height = 34 }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 3 - (v / max) * (height - 6)]);
  const line = smoothPath(pts);
  return (
    <svg width={width} height={height} className="block overflow-visible">
      <path d={`${line} L${width},${height} L0,${height} Z`} fill={color} opacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={1.6} />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={color} />
    </svg>
  );
}

// rows x columns, cell colour = count. click a cell to filter on both
function Heatmap({ cross, total, filters, onToggle, labelOf }) {
  const tip = useChartTip();
  const max = Math.max(1, ...cross.cells.map(c => c.count));
  const get = (r, c) => cross.cells.find(x => x.row === r && x.col === c)?.count || 0;
  const rowTot = (r) => cross.cells.filter(x => x.row === r).reduce((a, x) => a + x.count, 0);
  const pickedR = filters[cross.rows_col] || [], pickedC = filters[cross.cols_col] || [];
  const pick = (r, c) => {
    if (!pickedR.includes(r)) onToggle(cross.rows_col, r);
    if (!pickedC.includes(c)) onToggle(cross.cols_col, c);
  };
  return (
    <div className="overflow-x-auto ct-scroll -mx-1 px-1">
      <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
        <thead>
          <tr>
            <th className="text-left text-[11px] font-johnson-text font-normal text-jj-gray-06 pb-1 pr-2 align-bottom whitespace-nowrap">
              {labelOf(cross.rows_col)} ↓ · {labelOf(cross.cols_col)} →
            </th>
            {cross.cols.map(c => (
              <th key={c} className="text-[10.5px] font-johnson-text font-medium text-jj-gray-07 pb-1 px-1 align-bottom max-w-[110px]">
                <div className="truncate" title={c}>{c}</div>
              </th>
            ))}
            <th className="text-[11px] font-johnson-text font-normal text-jj-gray-06 pb-1 pl-1 align-bottom">Total</th>
          </tr>
        </thead>
        <tbody>
          {cross.rows.map(r => (
            <tr key={r}>
              <td className="text-[11.5px] font-johnson-text text-jj-gray-08 pr-2 max-w-[170px]"><div className="truncate" title={r}>{r}</div></td>
              {cross.cols.map(c => {
                const n = get(r, c);
                const a = n ? 0.12 + 0.83 * Math.sqrt(n / max) : 0;
                return (
                  <td key={c}
                    onClick={() => n && pick(r, c)}
                    onMouseMove={(e) => tip.show(e, [{ label: `${r} · ${c}`, header: true }, { label: 'Records', value: fmtNum(n), color: '#eb1700' },
                      { label: `Share of ${r}`, value: `${pct(n, rowTot(r))}%` }, { label: 'Share of all', value: `${pct(n, total)}%` }, ...(n ? [{ label: 'Click to filter on both', value: '' }] : [])])}
                    onMouseLeave={tip.hide}
                    className={`h-[34px] min-w-[62px] rounded-md text-center text-[11px] font-johnson-text tabular-nums transition-transform ${n ? 'cursor-pointer hover:scale-[1.04]' : ''}`}
                    style={{ background: n ? `rgba(200,18,0,${a})` : '#f6f4f2', color: a > 0.6 ? '#fff' : '#312c2a', fontWeight: a > 0.6 ? 700 : 500 }}>
                    {n ? compact(n) : ''}
                  </td>
                );
              })}
              <td className="text-[11px] font-johnson-text text-jj-gray-07 tabular-nums pl-1 text-right">{compact(rowTot(r))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-2 mt-2.5 text-[11px] font-johnson-text text-jj-gray-06">
        <span>Fewer</span>
        <span className="h-[6px] w-28 rounded-full" style={{ background: 'linear-gradient(90deg, rgba(200,18,0,.12), rgba(200,18,0,.95))' }} />
        <span>More</span>
      </div>
      {tip.node}
    </div>
  );
}

const fmtMeasure = (v, unit) => {
  if (v == null) return '—';
  if (unit === 'year') return String(Math.round(v));
  const n = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${compact(n)}${unit === '%' ? '%' : ''}`;
};

// histogram between p1 and p99, median marked
function MeasureCard({ m }) {
  const tip = useChartTip();
  const [w, ref] = useElementWidth();
  const H = 120;
  const max = Math.max(1, ...m.bins.map(b => b.count));
  const bw = m.bins.length ? w / m.bins.length : 0;
  const medX = m.bins.length && m.hi > m.lo ? ((m.median - m.lo) / (m.hi - m.lo)) * w : null;
  const unit = m.unit && m.unit !== 'year' && m.unit !== '%' ? ` ${m.unit}` : '';
  return (
    <Card className="px-5 py-4 min-w-0">
      <CardTitle title={m.label} sub={`${fmtNum(m.count)} records with a value · middle 98% shown`} />
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[['Median', m.median, '#0f68b2'], ['Average', m.avg, '#2a7a12'], ['90th pct', m.p90, '#7d33b0']].map(([l, v, c]) => (
          <div key={l} className="rounded-xl px-3 py-2" style={{ background: `${c}0d`, boxShadow: `inset 0 0 0 1px ${c}1a` }}>
            <div className="font-johnson-display font-bold text-[17px] leading-none tabular-nums" style={{ color: c }}>{fmtMeasure(v, m.unit)}<span className="text-[11px] font-johnson-text font-normal text-jj-gray-06">{unit}</span></div>
            <div className="text-[10.5px] font-johnson-text uppercase tracking-wider text-jj-gray-07 mt-1">{l}</div>
          </div>
        ))}
      </div>
      <div ref={ref} className="relative">
        {w > 0 && m.bins.length > 0 ? (
          <svg width={w} height={H + 16} className="block">
            {m.bins.map((b, i) => {
              const h = (b.count / max) * H;
              return (
                <rect key={i} x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={Math.max(h, b.count ? 1.5 : 0)} rx={3}
                  fill="#0f68b2" opacity={0.55 + 0.45 * (b.count / max)}
                  onMouseMove={(e) => tip.show(e, [{ label: `${fmtMeasure(b.from, m.unit)} – ${fmtMeasure(b.to, m.unit)}${unit}`, header: true }, { label: 'Records', value: fmtNum(b.count), color: '#0f68b2' }])}
                  onMouseLeave={tip.hide} />
              );
            })}
            {medX != null && (
              <g pointerEvents="none">
                <line x1={medX} x2={medX} y1={0} y2={H} stroke="#eb1700" strokeWidth={1.5} strokeDasharray="4 3" />
                <text x={Math.min(w - 4, Math.max(4, medX))} y={H + 13} textAnchor="middle" fill="#eb1700" style={{ fontSize: 10 }}>median</text>
              </g>
            )}
          </svg>
        ) : <div className="text-xs font-johnson-text text-jj-gray-07 py-8 text-center">Not enough values to chart.</div>}
        {m.bins.length > 0 && (
          <div className="flex justify-between text-[11px] font-johnson-text text-jj-gray-06 tabular-nums -mt-3">
            <span>{fmtMeasure(m.lo, m.unit)}</span><span>{fmtMeasure(m.hi, m.unit)}</span>
          </div>
        )}
      </div>
      {tip.node}
    </Card>
  );
}

// how full the key columns are
function Completeness({ data, labelOf }) {
  const cols = [...data.columns].sort((a, b) => b.pct - a.pct);
  const tone = (p) => (p >= 90 ? '#2a7a12' : p >= 60 ? '#a35d00' : '#c21300');
  return (
    <div className="flex flex-col gap-[9px]">
      {cols.map(c => (
        <div key={c.column} title={`${fmtNum(c.filled)} of ${fmtNum(data.total)} filled`}>
          <div className="flex justify-between text-[11.5px] font-johnson-text mb-[4px]">
            <span className="truncate text-jj-gray-08">{labelOf(c.column)}</span>
            <span className="tabular-nums flex-shrink-0 font-medium" style={{ color: tone(c.pct) }}>{c.pct}%</span>
          </div>
          <div className="h-[6px] rounded-full bg-[#ece9e6] overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: barFill(tone(c.pct)) }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ============================== table picker ============================== */

function Panel({ children }) {
  return (
    <aside className="ct-rise ct-scroll lg:w-[330px] xl:w-[350px] flex-shrink-0 relative overflow-hidden lg:overflow-y-auto rounded-[20px] border border-jj-gray-03 bg-white shadow-[0_1px_3px_rgba(49,44,42,.05)]">
      <div className="ct-dots absolute inset-x-0 top-0 h-[220px] opacity-80 pointer-events-none" style={{ maskImage: 'linear-gradient(to bottom, #000, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000, transparent)' }} />
      <div className="absolute -top-20 -right-16 w-[260px] h-[260px] rounded-full bg-jj-red/[.06] blur-3xl pointer-events-none" />
      <div className="absolute top-40 -left-24 w-[240px] h-[240px] rounded-full bg-jj-blue-03/[.05] blur-3xl pointer-events-none" />
      <div className="relative p-6 flex flex-col gap-5">{children}</div>
    </aside>
  );
}

function TileSkel() {
  return (
    <div className="rounded-xl px-3.5 py-3 bg-[#faf9f8] border border-jj-gray-02 flex flex-col gap-2" role="status" aria-label="Loading">
      <Bar w="50%" h={18} className="!rounded-md" />
      <Bar w="75%" h={8} />
    </div>
  );
}

function Tile({ value, label, color, title }) {
  return (
    <div className="rounded-xl px-3.5 py-3 min-w-0" style={{ background: `${color}0f`, boxShadow: `inset 0 0 0 1px ${color}1f` }} title={title}>
      <div className="font-johnson-display font-bold text-[22px] leading-none tabular-nums truncate" style={{ color }}>{value}</div>
      <div className="mt-1.5 text-[11px] font-johnson-text uppercase tracking-wider text-jj-gray-07 truncate">{label}</div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder, size = 'lg' }) {
  const big = size === 'lg';
  return (
    <div className="relative w-full">
      <Icon src={searchIcon} tint="gray" className={`absolute w-[13px] h-[13px] ${big ? 'left-3.5 top-[12px]' : 'left-2.5 top-[9px]'}`} />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full border bg-white font-johnson-text text-jj-gray-08 placeholder:text-jj-gray-06 focus:outline-none transition-shadow ${big
          ? 'pl-10 pr-9 py-2.5 rounded-xl border-jj-gray-02 text-[13px] shadow-[0_1px_2px_rgba(49,44,42,.04)] focus:border-jj-red/40 focus:ring-4 focus:ring-jj-red/[.08]'
          : 'pl-8 pr-7 py-2 rounded-lg border-jj-gray-03 text-xs focus:border-jj-blue-03'}`}
      />
      {value && (
        <button onClick={() => onChange('')} title="Clear" className={`absolute p-1.5 rounded-full hover:bg-jj-gray-01 ${big ? 'right-2.5 top-[9px]' : 'right-1 top-[5px]'}`}>
          <Icon src={closeIcon} tint="gray" className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}

// same shape as a table card: icon, name, blurb, count, bar
function TableCardSkel() {
  return (
    <div className="rounded-[18px] border-[1.5px] border-jj-gray-02 bg-white px-4 py-3.5 flex flex-col">
      <div className="flex items-start gap-3">
        <div className="ct-shimmer w-10 h-10 rounded-xl flex-shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col gap-2 pt-0.5">
          <Bar w="70%" h={12} />
          <Bar w="92%" h={8} />
          <Bar w="60%" h={8} />
        </div>
      </div>
      <div className="flex-1 min-h-[10px]" />
      <div className="flex items-end justify-between"><Bar w="34%" h={18} className="!rounded-md" /><Bar w="18%" h={8} /></div>
      <Bar h={4} className="mt-2" />
      <Bar w="50%" h={8} className="mt-2.5" />
    </div>
  );
}

function PickerSkeleton() {
  return (
    <div className="lg:h-full flex flex-col lg:flex-row gap-4 p-5" role="status" aria-label="Loading Cortellis tables">
      <div className="lg:w-[330px] xl:w-[350px] flex-shrink-0 rounded-[20px] border border-jj-gray-02 bg-white p-6 space-y-4">
        <div className="ct-shimmer h-5 w-32 rounded-full" />
        <div className="ct-shimmer h-7 w-[80%] rounded-lg" />
        <div className="ct-shimmer h-4 w-full rounded" />
        <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map(i => <TileSkel key={i} />)}</div>
        <div className="ct-shimmer h-10 w-full rounded-xl" />
      </div>
      <div className="flex-1 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gridAutoRows: 'minmax(140px, 1fr)' }}>
        {Array.from({ length: 9 }).map((_, i) => <TableCardSkel key={i} />)}
      </div>
    </div>
  );
}

function Picker({ sources, onPick }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('rows');
  const max = Math.max(1, ...sources.map(s => s.rows || 0));
  const total = sources.reduce((n, s) => n + (s.rows || 0), 0);
  const biggest = [...sources].sort((a, b) => (b.rows || 0) - (a.rows || 0))[0];
  const newest = sources.map(s => s.updated).filter(Boolean).sort().pop();
  const counting = sources.some(s => !('rows' in s)); // cards are up, row counts still on the way
  const needle = q.trim().toLowerCase();
  const shown = sources
    .filter(s => !needle || `${s.label} ${s.table} ${s.blurb || ''}`.toLowerCase().includes(needle))
    .sort((a, b) => (sort === 'rows' ? (b.rows ?? -1) - (a.rows ?? -1) : a.label.localeCompare(b.label)));

  return (
    <div className="flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
      <div className="lg:h-full flex flex-col lg:flex-row gap-4 p-5">
        <Panel>
          <div className="flex items-center gap-3.5">
            <span className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #eb170024, #eb17000a)', boxShadow: 'inset 0 0 0 1px #eb17002e' }}>
              <Icon src={dataVizIcon} className="w-6 h-6" />
            </span>
            <div className="min-w-0">
              <div className="text-[10.5px] font-johnson-text font-bold uppercase tracking-wider text-jj-red">External source</div>
              <h2 className="font-johnson-display font-bold text-[24px] leading-tight text-jj-gray-08">Cortellis</h2>
            </div>
          </div>
          <p className="text-[12.5px] font-johnson-text text-jj-gray-07 leading-relaxed -mt-1">
            Trials, products, regulatory milestones, advisory meetings, PMRCs and health authority news, brought together for regulatory intelligence.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Tile value={sources.length} label="Tables" color="#eb1700" />
            {counting ? [0, 1, 2].map(i => <TileSkel key={i} />) : (
              <>
                <Tile value={compact(total)} label="Records" color="#0f68b2" title={fmtNum(total)} />
                <Tile value={biggest ? compact(biggest.rows) : '—'} label={biggest ? `Largest · ${biggest.label}` : 'Largest'} color="#328714" />
                <Tile value={newest ? fmtDate(newest, { month: 'short', year: 'numeric' }) : '—'} label="Last refreshed" color="#8c3bbb" />
              </>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-[10.5px] font-johnson-text font-bold uppercase tracking-wider text-jj-gray-07">Find a table</div>
            <SearchBox value={q} onChange={setQ} placeholder="Filter tables…" />
            <div className="flex items-center bg-[#f7f5f3] rounded-xl p-[3px] gap-0.5">
              {[['rows', 'Most records'], ['name', 'A–Z']].map(([id, label]) => (
                <button key={id} onClick={() => setSort(id)}
                  className={`flex-1 py-[5px] rounded-[9px] text-[11.5px] font-johnson-text transition-all ${sort === id ? 'bg-white text-jj-red font-medium shadow-[0_1px_3px_rgba(49,44,42,.08)]' : 'text-jj-gray-07 hover:text-jj-gray-08'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </Panel>

        <section className="flex-1 min-w-0 min-h-0 flex flex-col gap-3">
          <div className="flex items-baseline gap-2.5 px-1">
            <h3 className="font-johnson-display font-bold text-[18px] text-jj-gray-08">Pick a table</h3>
            <span className="text-[12px] font-johnson-text text-jj-gray-06 tabular-nums">{shown.length} of {sources.length}</span>
          </div>
          {shown.length === 0 ? (
            <div className="flex-1 min-h-[220px] flex flex-col items-center justify-center bg-white/70 border border-dashed border-jj-gray-03 rounded-[20px] text-center px-5">
              <div className="text-[14px] font-johnson-display font-bold text-jj-gray-08">No tables match "{q.trim()}"</div>
              <button onClick={() => setQ('')} className="mt-2 text-xs font-johnson-text text-jj-blue-03 underline">Clear filter</button>
            </div>
          ) : (
            <div className="ct-scroll flex-1 min-h-0 lg:overflow-y-auto grid gap-3.5 p-[2px] -m-[2px] content-start"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gridAutoRows: 'minmax(150px, 176px)' }}>
              {shown.map((s, i) => {
                const c = PALETTE[sources.indexOf(s) % PALETTE.length];
                return (
                  <button key={s.id} onClick={() => onPick(s.id)}
                    style={{ animationDelay: `${Math.min(i, 14) * 35}ms`, '--c': c, '--c-b': `${c}4d`, background: `linear-gradient(160deg, #fff 55%, ${c}0b)` }}
                    className="ct-rise group relative overflow-hidden text-left rounded-[18px] px-4 py-3.5 border-[1.5px] border-[color:var(--c-b)] shadow-[0_1px_3px_rgba(49,44,42,.04)] transition-all duration-200 flex flex-col hover:-translate-y-[2px] hover:shadow-[0_12px_28px_rgba(49,44,42,.10)] hover:border-[color:var(--c)] focus:outline-none focus-visible:ring-4 focus-visible:ring-jj-blue-03/20">
                    <span className="absolute left-0 top-4 bottom-4 w-[3px] rounded-r-full" style={{ background: c }} />
                    <div className="relative flex items-start gap-3">
                      <span className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0" style={{ background: `${c}12` }}>
                        <Icon src={databaseIcon} tint="red" className="w-[17px] h-[17px]" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-johnson-display font-bold text-[14.5px] leading-snug text-jj-gray-08 line-clamp-2">{s.label}</div>
                        <div className="mt-0.5 text-[11px] font-johnson-text text-jj-gray-07 leading-snug line-clamp-2">{s.blurb}</div>
                      </div>
                    </div>
                    <div className="flex-1 min-h-[10px]" />
                    <div className="relative flex items-baseline justify-between">
                      {'rows' in s
                        ? <span className="font-johnson-display font-bold text-[20px] leading-none tabular-nums" style={{ color: c }}>{fmtNum(s.rows)}</span>
                        : <Bar w="34%" h={18} className="!rounded-md" />}
                      <span className="text-[10.5px] font-johnson-text uppercase tracking-wider text-jj-gray-06">records</span>
                    </div>
                    {'rows' in s ? (
                      <div className="relative mt-1.5 h-[4px] rounded-full bg-[#ece9e6] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(3, ((s.rows || 0) / max) * 100)}%`, background: `linear-gradient(90deg, ${c}99, ${c})` }} />
                      </div>
                    ) : <Bar h={4} className="relative mt-1.5" />}
                    <div className="relative mt-2.5 flex items-center gap-1.5 min-w-0">
                      <span className="flex-1 min-w-0 truncate text-[11px] font-johnson-text text-jj-gray-06" title={s.blurb || undefined}>{s.blurb || 'View records'}</span>
                      <span className="flex items-center gap-1 text-[11px] font-johnson-text font-medium flex-shrink-0 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" style={{ color: c }}>
                        Open <Icon src={chevronRightIcon} tint="gray" className="w-2.5 h-2.5" />
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/* ============================== filter rail ============================== */

function Facet({ label, options, selected, onToggle, color, defaultOpen, more }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const max = Math.max(1, ...options.map(o => o.count));
  return (
    <div className="border-b border-jj-gray-01 last:border-0">
      <button onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="w-full flex items-center justify-between px-[18px] py-3.5 text-left hover:bg-jj-gray-01/50 transition-colors">
        <span className="text-[11px] font-johnson-text font-bold uppercase tracking-wider text-jj-gray-07 truncate">
          {label}
          {selected.length > 0 && (
            <span className="ml-2 inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full bg-jj-red text-white text-[11px] font-medium normal-case tracking-normal">{selected.length}</span>
          )}
        </span>
        <Icon src={chevronRightIcon} tint="gray" className={`w-2.5 h-2.5 flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="px-[18px] pb-3.5">
          {options.length === 0 && <div className="text-xs font-johnson-text text-jj-gray-07 py-1.5">Nothing for current filters</div>}
          {options.map(o => {
            const checked = selected.includes(o.value);
            return (
              <label key={o.value} className="flex flex-col gap-1.5 py-2 px-1 -mx-1 rounded cursor-pointer hover:bg-jj-gray-01/60">
                <div className="flex items-center gap-2">
                  <input type="checkbox" checked={checked} onChange={() => onToggle(o.value)} className="accent-[#0f68b2] flex-shrink-0" />
                  <span className={`flex-1 truncate text-[12.5px] font-johnson-text ${checked ? 'font-bold' : 'font-medium'} text-jj-gray-08`} title={o.value}>{o.value}</span>
                  <span className="text-[11px] font-johnson-text text-jj-gray-07 tabular-nums flex-shrink-0">{compact(o.count)}</span>
                </div>
                <div className="h-[5px] rounded-full bg-[#ece9e6] ml-[22px] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.round((o.count / max) * 100)}%`, background: barFill(color) }} />
                </div>
              </label>
            );
          })}
          {more && <div className="text-[10.5px] font-johnson-text text-jj-gray-06 pt-1">Top {options.length} shown · use search for the rest</div>}
        </div>
      )}
    </div>
  );
}

function Rail({ meta, overview, error, filters, onToggle, query, setQuery, years, setYears, count, clearAll, labelOf, collapsed, setCollapsed }) {
  const period = PERIODS.find(p => (p.years ? years && p.years[0] === years[0] && p.years[1] === years[1] : !years))?.id;
  if (collapsed) {
    return (
      <div className="w-10 flex-shrink-0 bg-white border-r border-jj-gray-02 flex flex-col items-center pt-3 gap-2">
        <button onClick={() => setCollapsed(false)} title="Expand filters" className="relative p-1.5 rounded hover:bg-jj-gray-01">
          <Icon src={filterIcon} tint="ink" className="w-[13px] h-[13px]" />
          {count > 0 && <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[15px] h-[15px] px-0.5 rounded-full bg-jj-red text-white text-[9px] font-medium">{count}</span>}
        </button>
      </div>
    );
  }
  return (
    <div className="w-[252px] flex-shrink-0 bg-white border-r border-jj-gray-02 flex flex-col overflow-hidden">
      <div className="px-[18px] pt-4 pb-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 text-[13px] font-johnson-text font-bold text-jj-gray-08">
          <Icon src={filterIcon} tint="ink" className="w-[13px] h-[13px]" />
          Refine
          {count > 0 && <span className="inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full bg-jj-red text-white text-[11px] font-medium">{count}</span>}
        </div>
        <button onClick={clearAll} disabled={count === 0} className="text-[11px] font-johnson-text text-jj-blue-03 disabled:opacity-40">Clear all</button>
        <button onClick={() => setCollapsed(true)} title="Collapse filters" className="p-1 rounded hover:bg-jj-gray-01">
          <Icon src={chevronRightIcon} tint="gray" className="w-2.5 h-2.5 rotate-180" />
        </button>
      </div>
      <div className="px-[18px] pb-3.5 space-y-2.5 border-b border-jj-gray-01 flex-shrink-0">
        <div title={meta ? `Looks in: ${meta.search.map(labelOf).join(', ')}` : undefined}>
          <SearchBox size="sm" value={query} onChange={setQuery} placeholder={meta ? `Search ${meta.label}…` : 'Search…'} />
        </div>
        {meta?.has_years && (
          <div>
            <div className="text-[11px] font-johnson-text text-jj-gray-07 mb-1.5">{meta.year_label}</div>
            <Segmented full value={period} onChange={(id) => setYears(PERIODS.find(p => p.id === id).years)} options={PERIODS.map(p => [p.id, p.label])} />
            {years && !period && (
              <div className="text-[11px] font-johnson-text text-jj-gray-07 mt-1.5">
                {years[0] === years[1] ? years[0] : `${years[0]}–${years[1]}`} · <button onClick={() => setYears(null)} className="text-jj-blue-03 underline">clear</button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto ct-scroll">
        {!overview?.facets && error ? (
          <div className="p-[18px] text-[12px] font-johnson-text text-jj-gray-07">Filters will show once the numbers load.</div>
        ) : !overview?.facets ? (
          <div className="p-[18px] space-y-5" role="status" aria-label="Loading filters">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between"><Bar w="45%" h={11} /><Bar w="12%" h={8} /></div>
                {i < 2 && [0, 1, 2].map(j => <div key={j} className="flex items-center gap-2"><Bar w={`${70 - j * 14}%`} h={8} /><Bar w="14%" h={8} className="ml-auto" /></div>)}
              </div>
            ))}
          </div>
        ) : overview.facets.map((f, i) => (
          <Facet key={f.column} label={labelOf(f.column)} options={f.values} selected={filters[f.column] || []}
            onToggle={(v) => onToggle(f.column, v)} color={PALETTE[i % PALETTE.length]} defaultOpen={i < 2 || (filters[f.column] || []).length > 0} more={f.more} />
        ))}
      </div>
      <div className="flex-shrink-0 px-[18px] py-3.5 border-t border-jj-gray-01 text-[10.5px] font-johnson-text text-jj-gray-06 leading-relaxed">
        Counts are records and follow the other filters. Values inside lists (like "Oncology,CNS") count once each.
      </div>
    </div>
  );
}

/* ============================== explore ============================== */

function KpiTile({ label, value, sub, color, title, children, loading }) {
  return (
    <div className="relative overflow-hidden rounded-[16px] bg-white border border-jj-gray-02 shadow-[0_1px_2px_rgba(49,44,42,.04),0_4px_14px_rgba(49,44,42,.03)] px-4 py-3 min-w-0">
      <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full pointer-events-none" style={{ background: `radial-gradient(circle, ${color}1f, transparent 70%)` }} />
      <div className="relative flex items-center gap-1.5 text-[11px] font-johnson-text font-bold uppercase tracking-wider truncate text-jj-gray-07">
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
        {label}
      </div>
      <div className="relative flex items-end justify-between gap-3 mt-1.5">
        {loading ? (
          <div className="min-w-0 flex-1 flex flex-col gap-2.5 pt-1" role="status" aria-label="Loading">
            <Bar w="55%" h={22} className="!rounded-lg" />
            <Bar w="78%" h={9} />
          </div>
        ) : (
          <div className="min-w-0">
            <div className="font-johnson-display font-bold text-[22px] leading-none text-jj-gray-08 tabular-nums truncate" title={title}>{value}</div>
            <div className="text-[12px] font-johnson-text text-jj-gray-07 mt-1.5 truncate" title={typeof sub === 'string' ? sub : undefined}>{sub}</div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

// year by year counts with change on the year before
function YearTable({ trend, stack, labelOf }) {
  const rows = [...trimTrend(trend).rows].reverse().slice(0, 15);
  const max = Math.max(1, ...rows.map(r => r.count));
  const top = (r) => Object.entries(r.by || {}).filter(([k]) => k !== 'Other').sort((a, b) => b[1] - a[1])[0];
  return (
    <div className="overflow-x-auto ct-scroll">
      <table className="w-full text-[12px] font-johnson-text border-separate border-spacing-0">
        <thead>
          <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-jj-gray-07">
            <th className="py-2 pr-3 border-b border-jj-gray-02">Year</th>
            <th className="py-2 pr-3 border-b border-jj-gray-02 text-right">Records</th>
            <th className="py-2 pr-3 border-b border-jj-gray-02 text-right">vs prior</th>
            <th className="py-2 pr-3 border-b border-jj-gray-02 w-[34%]"></th>
            {stack?.column && <th className="py-2 border-b border-jj-gray-02">Top {labelOf(stack.column).toLowerCase()}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const prev = rows[i + 1];
            const soFar = r.year === THIS_YEAR;
            // the current year isn't over, comparing it would always look like a drop
            const ch = !soFar && prev && prev.count ? Math.round(((r.count - prev.count) / prev.count) * 100) : null;
            const t = top(r);
            return (
              <tr key={r.year} className="hover:bg-[#faf9f8]">
                <td className="py-2 pr-3 border-b border-jj-gray-01 font-bold text-jj-gray-08 tabular-nums">{r.year}{soFar && <span className="ml-1.5 text-[10.5px] font-normal text-jj-gray-07">so far</span>}</td>
                <td className="py-2 pr-3 border-b border-jj-gray-01 text-right tabular-nums text-jj-gray-08">{fmtNum(r.count)}</td>
                <td className={`py-2 pr-3 border-b border-jj-gray-01 text-right tabular-nums font-medium ${ch == null ? 'text-jj-gray-07' : ch >= 0 ? 'text-[#2a7a12]' : 'text-jj-maroon-05'}`}>
                  {ch == null ? '—' : `${ch >= 0 ? '▲' : '▼'} ${Math.abs(ch)}%`}
                </td>
                <td className="py-2 pr-3 border-b border-jj-gray-01">
                  <div className="h-[8px] rounded-full bg-[#ece9e6] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: '#eb1700', opacity: soFar ? 0.5 : 1 }} />
                  </div>
                </td>
                {stack?.column && (
                  <td className="py-2 border-b border-jj-gray-01 text-jj-gray-08 max-w-[220px] truncate">
                    {t ? <>{t[0]} <span className="text-jj-gray-07 tabular-nums">· {pct(t[1], r.count)}%</span></> : '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ExploreSkeleton() {
  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {['#eb1700', '#0f68b2', '#2a7a12', '#7d33b0'].map(c => <KpiTile key={c} label={<Bar w={90} h={9} />} color={c} loading />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-3"><SkelCard height={280} className="xl:col-span-2" /><SkelCard height={280} /></div>
      <div className="grid gap-4 xl:grid-cols-5"><SkelCard height={300} lines={5} className="xl:col-span-2" /><SkelCard height={300} lines={6} className="xl:col-span-3" /></div>
    </div>
  );
}

function Explore({ section, meta, overview, insights, insightsError, onRetryInsights, loading, error, state, onToggle, setYears, setQuery, labelOf, openRecord, clearAll, goTo }) {
  if (!overview && error) {
    return <div className="p-5"><Empty title="Nothing to show yet" sub="The numbers for this table couldn't load. Use Retry above, or try another table." /></div>;
  }
  if (overview?.total == null) return <ExploreSkeleton />;
  // overview streams in: total first, then facets, trend, kpis, latest. undefined = still coming
  const { total, stack } = overview;
  const facets = overview.facets || [], trend = overview.trend || [], kpis = overview.kpis || {}, latest = overview.latest || [];
  const wait = { facets: !overview.facets, trend: !overview.trend, kpis: !overview.kpis, latest: !overview.latest };
  const insWait = (k) => !insights?._done && insights?.[k] === undefined;
  const anyFilter = Object.values(state.filters).some(v => v.length) || state.q || state.years;
  const f0 = facets[0], f1 = facets[1];
  const pastTrend = trend.filter(t => t.year < THIS_YEAR);
  const peak = pastTrend.length ? pastTrend.reduce((a, b) => (b.count > a.count ? b : a)) : null;
  const colorFor = (col) => PALETTE[Math.max(0, facets.findIndex(f => f.column === col)) % PALETTE.length];
  const spark = trimTrend(trend).rows.slice(-15).map(t => t.count);
  // same value, same colour in the mix ring, the trend and the legend
  const f0Colors = new Map((f0?.values || []).map((v, i) => [v.value, STACK[i % STACK.length]]));
  const stackExtra = (stack?.values || []).filter(v => v !== 'Other' && !f0Colors.has(v));
  const valueColor = (v) => (stack?.column === f0?.column && f0Colors.has(v)) ? f0Colors.get(v)
    : STACK[(f0Colors.size + stackExtra.indexOf(v)) % STACK.length];
  const growth = kpis.prior_12m ? pct(kpis.last_12m - kpis.prior_12m, kpis.prior_12m) : null;

  const insightsList = [];
  if (f0?.values[0]) insightsList.push(<><b>{pct(f0.values[0].count, total)}%</b> of records are <b>{f0.values[0].value}</b>{f0.values[1] ? <>, followed by <b>{f0.values[1].value}</b> ({pct(f0.values[1].count, total)}%)</> : null}.</>);
  if (f1?.values[0]) insightsList.push(<>Most common {labelOf(f1.column).toLowerCase()}: <b>{f1.values[0].value}</b> with {fmtNum(f1.values[0].count)} records.</>);
  if (insights?.leaders?.values?.[0]) insightsList.push(<><b>{insights.leaders.values[0].value}</b> leads {insights.leaders.label.toLowerCase().replace(/^top /, '')} with {fmtNum(insights.leaders.values[0].count)} records.</>);
  if (peak) insightsList.push(<>Busiest {meta.year_label.toLowerCase()} was <b>{peak.year}</b> with {fmtNum(peak.count)} records.</>);
  if (kpis.last_12m != null && (kpis.last_12m || kpis.prior_12m)) {
    insightsList.push(<><b>{fmtNum(kpis.last_12m)}</b> records in the last 12 months{growth != null ? <>, {growth >= 0 ? 'up' : 'down'} {Math.abs(growth)}% on the year before</> : null}.</>);
  }
  const m0 = insights?.measures?.find(m => m.count);
  if (m0) insightsList.push(<>Median {m0.label.toLowerCase()} is <b>{fmtMeasure(m0.median, m0.unit)}{m0.unit && !['%', 'year'].includes(m0.unit) ? ` ${m0.unit}` : ''}</b>.</>);
  const weak = insights?.completeness?.columns?.filter(c => c.pct < 50) || [];
  if (weak.length) insightsList.push(<>{weak.length === 1 ? <><b>{labelOf(weak[0].column)}</b> is</> : <><b>{weak.length} key columns</b> are</>} under half filled, keep that in mind when filtering.</>);

  const kpiRow = (
    <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 flex-shrink-0">
      <KpiTile label="Records" color="#eb1700" value={compact(total)} title={fmtNum(total)}
        sub={anyFilter ? `${fmtNum(total)} matching` : `${fmtNum(total)} total`}>
        <Sparkline values={spark} color="#eb1700" width={84} />
      </KpiTile>
      {wait.kpis || wait.trend ? <KpiTile label="Last 12 months" color="#0f68b2" loading /> : kpis.last_12m != null && (kpis.last_12m > 0 || kpis.prior_12m > 0) ? (
        <KpiTile label="Last 12 months" color="#0f68b2" value={fmtNum(kpis.last_12m)}
          sub={growth == null ? 'by record date' : <span className={growth >= 0 ? 'text-[#2a7a12] font-bold' : 'text-jj-maroon-05 font-bold'}>{growth >= 0 ? '▲' : '▼'} {Math.abs(growth)}% <span className="text-jj-gray-07 font-normal">vs prior 12 months</span></span>} />
      ) : (
        <KpiTile label={`Peak ${meta.year_label.toLowerCase()}`} color="#0f68b2" value={peak?.year ?? '—'} sub={peak ? `${fmtNum(peak.count)} records` : ''} />
      )}
      <KpiTile label={f0 ? `Top ${labelOf(f0.column).toLowerCase()}` : 'Top value'} color="#2a7a12" loading={wait.facets}
        value={f0?.values[0] ? `${pct(f0.values[0].count, total)}%` : '—'} sub={f0?.values[0]?.value || ''} />
      <KpiTile label="Newest record" color="#7d33b0" loading={wait.kpis || wait.trend}
        value={kpis.newest ? fmtDate(kpis.newest, { month: 'short', year: 'numeric' }) : (peak ? trend[trend.length - 1].year : '—')}
        sub={kpis.newest ? `${daysAgo(kpis.newest)}${kpis.oldest ? ` · data since ${new Date(kpis.oldest).getFullYear()}` : ''}` : ''} />
    </div>
  );

  const trendCard = (tall) => meta.has_years && (wait.trend ? <SkelCard height={tall ? 350 : 280} className={tall ? '' : 'xl:col-span-2'} /> : (
    <Card className={`px-5 py-4 min-w-0 ${tall ? '' : 'xl:col-span-2'}`}>
      <YearActivity trend={trend} stack={stack} years={state.years} onPickYear={setYears} labelOf={labelOf} height={tall ? 280 : 210} valueColor={valueColor}
        title="Records over time" sub={`By ${meta.year_label.toLowerCase()}${stack?.column ? `, split by ${labelOf(stack.column).toLowerCase()}` : ''} · hover for detail · click to focus a year`} />
    </Card>
  ));

  const mixCard = (center = true) => wait.facets ? <SkelCard height={280} /> : f0 && (
    <Card className={`px-5 py-4 min-w-0 flex flex-col ${meta.has_years ? '' : 'xl:col-span-3'}`}>
      <CardTitle title={`${labelOf(f0.column)} mix`} sub="Share of records · click to filter" />
      <div className={`flex-1 flex justify-center py-2 ${center ? 'items-center' : 'items-start pt-4'}`}><DonutCard big size={156} values={f0.values} total={total} active={state.filters[f0.column] || []} onPick={(v) => onToggle(f0.column, v)} colors={STACK} /></div>
    </Card>
  );

  const takeaways = (
    <Card className="px-5 py-4 min-w-0 xl:col-span-2">
      <CardTitle title="Key takeaways" sub="Worked out from the records in view" />
      <ul className="flex flex-col gap-2">
        {insightsList.map((t, i) => (
          <li key={i} className="flex gap-2.5 items-start rounded-xl bg-[#faf9f8] border border-jj-gray-01 px-3 py-2.5 text-[12.5px] font-johnson-text text-jj-gray-08 leading-relaxed">
            <span className="flex-shrink-0 w-[22px] h-[22px] rounded-full text-[11px] font-bold flex items-center justify-center mt-[1px] text-white"
              style={{ background: PALETTE[i % PALETTE.length] }}>{i + 1}</span>
            <span className="min-w-0 [&_b]:text-jj-gray-08 [&_b]:font-bold">{t}</span>
          </li>
        ))}
        {!overview._done && [0, 1].map(i => (
          <li key={`w${i}`} className="flex gap-2.5 items-center" role="status" aria-label="Loading">
            <div className="ct-shimmer w-[22px] h-[22px] rounded-full flex-shrink-0" />
            <Bar w={`${80 - i * 22}%`} h={10} />
          </li>
        ))}
      </ul>
    </Card>
  );

  const latestCard = wait.latest ? <SkelCard height={360} lines={7} className="xl:col-span-3" /> : latest.length > 0 && (
    <Card className="min-w-0 overflow-hidden xl:col-span-3">
      <div className="px-5 pt-4 pb-3 border-b border-jj-gray-02 flex items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-johnson-text font-bold text-jj-gray-08">Latest records</div>
          <div className="text-[11.5px] font-johnson-text text-jj-gray-07 mt-0.5">Newest first · click a record for full detail</div>
        </div>
        <button onClick={() => goTo('records')} className={btn}>All records <Icon src={chevronRightIcon} tint="ink" className="w-2.5 h-2.5" /></button>
      </div>
      {latest.map((r, i) => (
        <div key={`${r.key}-${i}`} onClick={() => openRecord({ key: r.key, title: r.title })}
          className="group flex items-center gap-3 px-5 py-2.5 border-b border-jj-gray-01 last:border-0 hover:bg-[#faf9f8] cursor-pointer transition-colors">
          <div className="w-[46px] flex-shrink-0 text-center rounded-lg py-1 bg-jj-red/[.06]">
            <div className="text-[10px] font-johnson-text font-bold uppercase text-[#c21300] leading-none">{fmtDate(r.date, { month: 'short' })}</div>
            <div className="text-[11px] font-johnson-text font-bold text-jj-gray-08 leading-none mt-1">{fmtDate(r.date, { year: 'numeric' })}</div>
          </div>
          <div className="min-w-0 flex-1 flex items-center gap-3">
            <div className="min-w-0 flex-1 text-[13px] font-johnson-text font-bold text-jj-gray-08 leading-snug group-hover:text-[#c21300] transition-colors truncate" title={r.title || ''}>{highlight(r.title || 'Untitled', state.q)}</div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {r.tags.map(t => <Pill key={t.column} color={t.column === f0?.column && f0Colors.has(t.value) ? f0Colors.get(t.value) : colorFor(t.column)} title={labelOf(t.column)}>{t.value}</Pill>)}
              {isUrl(r.url) && (
                <a href={r.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-[11.5px] font-johnson-text font-medium text-jj-blue-03 hover:underline">Source ↗</a>
              )}
            </div>
          </div>
          <span className="flex-shrink-0 w-[56px] text-right text-[11px] font-johnson-text text-jj-gray-07">{daysAgo(r.date)}</span>
        </div>
      ))}
    </Card>
  );

  const facetCard = (f) => {
    const i = facets.indexOf(f);
    const c = PALETTE[i % PALETTE.length];
    const small = f.values.length <= 4 && !f.more;
    return (
      <Card key={f.column} className="px-5 py-4 min-w-0">
        <CardTitle title={labelOf(f.column)} sub={`${f.more ? `Top ${Math.min(8, f.values.length)} · ` : ''}click to filter`}
          right={(state.filters[f.column] || []).length > 0 && <span className="text-[11px] font-johnson-text font-bold text-[#c21300] whitespace-nowrap">{state.filters[f.column].length} selected</span>} />
        {small
          ? <div className="py-1"><DonutCard values={f.values} total={total} active={state.filters[f.column] || []} onPick={(v) => onToggle(f.column, v)} colors={[c, ...STACK.filter(x => x !== c)]} /></div>
          : <RankedBars rows={f.values.slice(0, 8)} active={state.filters[f.column] || []} onPick={(v) => onToggle(f.column, v)} color={c} total={total} />}
      </Card>
    );
  };

  const waiting = insightsError
    ? <LoadFailed what="these charts" error={insightsError} onRetry={onRetryInsights} />
    : <div className="grid gap-4 xl:grid-cols-2 flex-shrink-0"><SkelCard height={300} /><SkelCard height={300} lines={7} /></div>;

  let body;
  if (total === 0) {
    body = <Empty title="No records match" sub="Widen the period, change the search or clear a filter." action="Clear all filters" onAction={anyFilter ? clearAll : null} />;
  } else if (section === 'trends') {
    body = (
      <>
        {trendCard(true)}
        <div className="grid gap-4 xl:grid-cols-3 flex-shrink-0">
          <Card className="px-5 py-4 min-w-0 xl:col-span-2">
            <CardTitle title="Year by year" sub="Most recent first · change on the year before" />
            {wait.trend ? <div className="flex flex-col gap-3 pt-1">{Array.from({ length: 6 }).map((_, i) => <Bar key={i} w={`${96 - i * 6}%`} h={10} />)}</div> : <YearTable trend={trend} stack={stack} labelOf={labelOf} />}
          </Card>
          {mixCard(false)}
        </div>
      </>
    );
  } else if (section === 'breakdowns') {
    body = <div className="grid gap-4 flex-shrink-0" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))' }}>{wait.facets ? [0, 1, 2, 3].map(i => <SkelCard key={i} height={300} lines={6} />) : facets.map(facetCard)}</div>;
  } else if (section === 'relationships') {
    body = !insights || insightsError ? waiting : (
      <>
        {insWait('cross') && <SkelCard height={340} />}
        {insights.cross?.cells?.length > 0 && (
          <Card className="px-5 py-4 min-w-0">
            <CardTitle title={`${labelOf(insights.cross.rows_col)} × ${labelOf(insights.cross.cols_col)}`} sub="How the two break down together · click a cell to filter on both" />
            <Heatmap cross={insights.cross} total={total} filters={state.filters} onToggle={onToggle} labelOf={labelOf} />
          </Card>
        )}
        {insights.leaders?.values?.length > 0 && (
          <div className="grid gap-4 xl:grid-cols-2 flex-shrink-0">
            <Card className="px-5 py-4 min-w-0">
              <CardTitle title={insights.leaders.label} sub="By records · click to search for it" />
              <RankedBars rows={insights.leaders.values} color="#0f68b2" rank onPick={(v) => setQuery(v)} />
            </Card>
            {f1 && facetCard(f1)}
          </div>
        )}
        {insWait('leaders') && <div className="grid gap-4 xl:grid-cols-2 flex-shrink-0"><SkelCard height={300} lines={7} /><SkelCard height={300} lines={7} /></div>}
        {insights._done && !insights.cross?.cells?.length && !insights.leaders?.values?.length && <Empty title="Nothing to compare for this table" />}
      </>
    );
  } else if (section === 'numbers') {
    body = !insights || insightsError ? waiting : (
      <div className="grid gap-4 flex-shrink-0" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        {(insights.measures || []).filter(m => m.count).map(m => <MeasureCard key={m.column} m={m} />)}
        {insWait('measures') && <SkelCard height={300} />}
        {insWait('completeness') && <SkelCard height={300} lines={7} />}
        {insights.completeness && (
          <Card className="px-5 py-4 min-w-0">
            <CardTitle title="Data completeness" sub="Share of matching records with a value in each key column" />
            <Completeness data={insights.completeness} labelOf={labelOf} />
          </Card>
        )}
      </div>
    );
  } else {
    body = (
      <>
        <div className="grid gap-4 xl:grid-cols-3 flex-shrink-0">{trendCard(false)}{mixCard()}</div>
        <div className="grid gap-4 xl:grid-cols-5 flex-shrink-0">{takeaways}{latestCard}</div>
      </>
    );
  }

  return (
    <div className={`flex-1 min-h-0 overflow-y-auto ct-scroll transition-opacity ${loading ? 'opacity-75' : ''}`}>
      <div className="p-5 flex flex-col gap-4">
        {kpiRow}
        {body}
      </div>
    </div>
  );
}

/* ============================== data table ============================== */

function DataTable({ meta, state, labelOf, logInPage, onLoading, onSynced, canViewSql, reloadKey, openRecord, facetColors }) {
  const canDownload = useRBAC().hasPermission('downloadUnstructuredData');
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, parseInt(params.get('ctp') || '1', 10) || 1);
  const size = PAGE_SIZES.includes(+params.get('ctn')) ? +params.get('ctn') : 50;
  const rawSort = params.get('cts') || '';
  const sort = { col: rawSort.replace(/^-/, ''), desc: rawSort.startsWith('-') || !rawSort };
  const setView = (patch) => setParams(prev => {
    const n = new URLSearchParams(prev);
    Object.entries(patch).forEach(([k, v]) => { if (v == null || v === '' ) n.delete(k); else n.set(k, String(v)); });
    return n;
  }, { replace: true });
  const setPage = (v) => { const next = typeof v === 'function' ? v(page) : v; setView({ ctp: next > 1 ? next : null }); };
  const setSize = (v) => setView({ ctn: v === 50 ? null : v, ctp: null });
  const setSort = (v) => { const next = typeof v === 'function' ? v(sort) : v; setView({ cts: next.col ? `${next.desc ? '-' : ''}${next.col}` : null, ctp: null }); };
  const [allCols, setAllCols] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showSql, setShowSql] = useState(false);
  const qs = filterParams(state).toString();

  useEffect(() => {
    let dead = false;
    setLoading(true); setError(null);
    const p = new URLSearchParams(qs);
    p.set('page', page); p.set('size', size); p.set('sort', sort.col); p.set('desc', sort.desc);
    if (allCols) p.set('all_columns', 'true');
    if (reloadKey) p.set('bypass_cache', 'true');
    const ctl = new AbortController();
    apiStream(`/api/cortellis/table/${meta.id}?${p}`, part => { if (!dead) setData(part); }, ctl.signal)
      .then(() => { if (!dead) onSynced?.(Date.now()); })
      .catch(e => { if (!dead && !isAbort(e)) setError(e.message || String(e)); })
      .finally(() => { if (!dead) setLoading(false); });
    return () => { dead = true; ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.id, qs, page, size, rawSort, allCols, reloadKey, attempt]);
  useEffect(() => { onLoading?.(loading); }, [loading, onLoading]);
  useEffect(() => () => onLoading?.(false), [onLoading]);
  // a page past the end (old link, fewer results now) -> last page
  useEffect(() => {
    if (data?.total > 0 && page > Math.ceil(data.total / size)) setPage(Math.ceil(data.total / size));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, size]);

  // key column rides along for the drawer, hide it unless asked. all columns: skip ones empty on this page
  const visible = useMemo(() => {
    if (!data) return [];
    const idx = data.columns.map((_, i) => i);
    return allCols ? idx.filter(i => data.rows.some(r => !isEmpty(r[i]))) : idx.filter(i => meta.grid.includes(data.columns[i]));
  }, [data, allCols, meta]);

  const counted = data?.total != null; // rows land first, the count after
  const pages = counted ? Math.max(1, Math.ceil(data.total / size)) : page;
  const from = counted && data.total ? (page - 1) * size + 1 : 0;
  const to = counted ? Math.min(data.total, page * size) : 0;
  const toggleSort = (col) => {
    setSort(s => (s.col === col ? (s.desc ? { col, desc: false } : { col: '', desc: true }) : { col, desc: true }));
    logInPage?.('cortellis_sort', `Sorted Cortellis ${meta.label} by ${col}`);
  };
  const download = () => {
    const cols = visible.map(i => data.columns[i]);
    const blob = new Blob([toCsv(cols.map(labelOf), data.rows.map(r => visible.map(i => r[i])))], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cortellis_${meta.id}_page${page}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    logInPage?.('cortellis_download', `Downloaded Cortellis ${meta.label} page ${page}`);
  };
  const keyIdx = data && meta.key ? data.columns.indexOf(meta.key) : -1;
  const titleIdx = data ? data.columns.indexOf(meta.title) : -1;

  const cell = (c, v) => {
    if (isEmpty(v)) return <span className="text-jj-gray-04">—</span>;
    if (isUrl(v)) return <a href={v} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="text-jj-blue-03 hover:underline whitespace-nowrap">Open ↗</a>;
    if (looksLikeDate(v)) return <span className="tabular-nums whitespace-nowrap">{fmtDate(v)}</span>;
    if (facetColors[c]) return <Pill color={facetColors[c]}>{show(v)}</Pill>;
    if (c === meta.title) return <div className="font-medium text-jj-gray-08 leading-snug line-clamp-2 whitespace-normal">{highlight(show(v), state.q)}</div>;
    return <span title={show(v)}>{highlight(show(v), state.q)}</span>;
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3.5 p-5 overflow-hidden">
      {error && <LoadFailed what="records" error={error} onRetry={() => setAttempt(a => a + 1)} />}
      <div className="bg-white border border-jj-gray-02 rounded-[14px] shadow-[0_1px_3px_rgba(49,44,42,.05)] flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-[18px] py-3 border-b border-jj-gray-01 flex-wrap">
          <div className="text-[13px] font-johnson-text font-bold text-jj-gray-08">
            {meta.label} <span className="font-normal text-jj-gray-06 text-[11.5px] tabular-nums">{counted ? `${fmtNum(data.total)} records` : 'counting…'}</span>
          </div>
          <div className="flex items-center gap-3">
            <Segmented size="sm" value={allCols} onChange={(v) => { setAllCols(v); setSort({ col: '', desc: true }); }} options={[[false, 'Key columns'], [true, 'All columns']]} />
            {canViewSql && data?.sql && (
              <button onClick={() => setShowSql(s => !s)} className="text-[11px] font-johnson-text text-jj-blue-03 underline">{showSql ? 'Hide SQL' : 'View SQL'}</button>
            )}
            {canDownload && (
            <button onClick={download} disabled={loading || !data?.rows?.length} className={btn}>
              <Icon src={downloadIcon} tint="ink" className="w-3 h-3" />Download CSV
            </button>
            )}
          </div>
        </div>
        {showSql && data?.sql && (
          <pre className="flex-shrink-0 mx-[18px] mt-3 bg-[#faf9f8] border border-jj-gray-02 text-jj-gray-08 text-[11px] font-mono rounded-xl p-3 overflow-x-auto whitespace-pre-wrap max-h-40">{data.sql}</pre>
        )}
        <div className={`flex-1 min-h-0 overflow-auto ct-scroll relative ${loading && data ? 'opacity-60' : ''}`}>
          {!data?.columns ? (
            <div role="status" aria-label="Loading records">
              <div className="flex gap-4 px-3 py-3 bg-[#faf9f8] border-b border-jj-gray-02">{[18, 30, 14, 14, 12, 12].map((w, i) => <Bar key={i} w={`${w}%`} h={9} />)}</div>
              {Array.from({ length: 12 }).map((_, r) => (
                <div key={r} className="flex gap-4 px-3 py-3 border-b border-jj-gray-01">{[18, 30, 14, 14, 12, 12].map((w, i) => <Bar key={i} w={`${w - ((r + i) % 3) * 3}%`} h={8} />)}</div>
              ))}
            </div>
          ) : !data.rows.length && !loading ? (
            <div className="py-16 text-center">
              <div className="text-[13px] font-johnson-text font-bold text-jj-gray-08">No records match</div>
              <div className="text-xs font-johnson-text text-jj-gray-07 mt-1">Change the search or clear a filter in the rail.</div>
            </div>
          ) : (
            <table className="w-full border-separate border-spacing-0 text-xs font-johnson-text">
              <thead className="sticky top-0 z-[5]">
                <tr className="bg-[#faf9f8]">
                  {visible.map(i => {
                    const c = data.columns[i];
                    return (
                      <th key={c} onClick={() => toggleSort(c)} title={`Sort by ${labelOf(c)}`}
                        className="px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-wider text-jj-gray-07 whitespace-nowrap border-b border-r border-jj-gray-02 last:border-r-0 cursor-pointer hover:bg-jj-gray-02 select-none bg-[#faf9f8]">
                        {labelOf(c)}{sort.col === c ? (sort.desc ? ' ▼' : ' ▲') : ''}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, ri) => (
                  <tr key={ri} onClick={() => openRecord({ key: keyIdx >= 0 ? r[keyIdx] : null, title: titleIdx >= 0 ? r[titleIdx] : null, columns: data.columns, row: r })}
                    className={`hover:bg-jj-blue-03/[.04] cursor-pointer align-top transition-colors ${ri % 2 ? 'bg-[#fcfbfa]' : 'bg-white'}`}>
                    {visible.map(i => {
                      const c = data.columns[i];
                      return (
                        <td key={i} className={`px-3 py-2.5 border-b border-r border-jj-gray-01 last:border-r-0 text-jj-gray-08 ${c === meta.title ? 'min-w-[280px] max-w-[460px]' : 'max-w-[240px] truncate'}`}>
                          {cell(c, r[i])}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex-shrink-0 flex items-center justify-between gap-3 px-[18px] py-2.5 border-t border-jj-gray-01 text-[11.5px] font-johnson-text text-jj-gray-07 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="tabular-nums">{counted ? `${fmtNum(from)}–${fmtNum(to)} of ${fmtNum(data.total)}` : data?.rows?.length ? `${fmtNum(data.rows.length)} loaded…` : ''}</span>
            <span className="text-jj-gray-04">·</span>
            <span>Rows</span>
            <select value={size} onChange={e => { setSize(Number(e.target.value)); setPage(1); }}
              className="border border-jj-gray-03 rounded-lg px-2 py-1 text-[11.5px] bg-white focus:outline-none focus:border-jj-blue-03">
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2 tabular-nums">
            <button onClick={() => setPage(1)} disabled={page <= 1 || loading} className={btn}>First</button>
            <button onClick={() => setPage(p => p - 1)} disabled={page <= 1 || loading} className={btn}>Prev</button>
            <span className="px-1">Page {fmtNum(page)} of {fmtNum(pages)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={!counted || page >= pages || loading} className={btn}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== record drawer ============================== */

function RecordDrawer({ meta, record, onClose, labelOf, facetColors }) {
  const [full, setFull] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [showEmpty, setShowEmpty] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (!record.key) return;
    let dead = false;
    const ctl = new AbortController(); // cancelled on close so it stops holding a browser connection
    apiJson(`/api/cortellis/record/${meta.id}?key=${encodeURIComponent(record.key)}`, { signal: ctl.signal })
      .then(res => { if (!dead) setFull(res); })
      .catch(e => { if (!dead && !isAbort(e)) setError(e.message || String(e)); });
    return () => { dead = true; ctl.abort(); };
  }, [meta.id, record.key]);

  const cols = full?.columns || record.columns || [];
  const vals = full?.row || record.row || [];
  const get = (c) => { const i = cols.indexOf(c); return i >= 0 ? vals[i] : null; };
  const title = show(get(meta.title)) || record.title || 'Record';
  const text = meta.text ? get(meta.text) : null;
  const link = meta.url ? get(meta.url) : null;
  const tags = meta.facets.map(c => [c, get(c)]).filter(([, v]) => !isEmpty(v));
  const skip = new Set([meta.title, meta.text, ...meta.facets]);
  const rows = cols.map((c, i) => [c, vals[i]]).filter(([c, v]) => !skip.has(c) && (showEmpty || !isEmpty(v)));
  const emptyCount = cols.filter((c, i) => !skip.has(c) && isEmpty(vals[i])).length;
  const copy = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1500); };
    const fail = () => { setCopied('fail'); setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link || '').then(done).catch(fail);
    else fail();
  };

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="w-full max-w-[620px] h-full bg-white shadow-2xl flex flex-col" onClick={e => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="flex-shrink-0 px-5 py-4 border-b border-jj-gray-02 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10.5px] font-johnson-text uppercase tracking-wider text-jj-gray-07">Cortellis · {meta.label}</div>
            <h3 className="font-johnson-display font-bold text-[17px] leading-snug text-jj-gray-08 break-words mt-0.5">{title}</h3>
            {tags.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {tags.map(([c, v]) => <Pill key={c} color={facetColors[c]} title={labelOf(c)}>{show(v)}</Pill>)}
              </div>
            )}
          </div>
          <button autoFocus onClick={onClose} aria-label="Close" className="flex-shrink-0 p-1 rounded hover:bg-jj-gray-01 focus:outline-none focus-visible:ring-2 focus-visible:ring-jj-blue-03/40"><Icon src={closeIcon} alt="Close" tint="ink" className="w-4 h-4" /></button>
        </div>

        <div className="flex-1 overflow-y-auto ct-scroll">
          {!full && record.key && !error && <div className="px-5 pt-3 text-[11px] font-johnson-text text-jj-gray-06">Loading full record…</div>}
          {error && <div className="px-5 pt-3"><LoadFailed what="the full record (showing the table copy)" error={error} /></div>}
          {!isEmpty(text) && (
            <div className="px-5 py-4 border-b border-jj-gray-01">
              <div className="text-[11px] font-johnson-text font-bold uppercase tracking-wider text-jj-gray-07 mb-2">{labelOf(meta.text)}</div>
              <p className="text-[12.5px] font-johnson-text text-jj-gray-08 leading-relaxed whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto ct-scroll">{show(text)}</p>
            </div>
          )}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] font-johnson-text font-bold uppercase tracking-wider text-jj-gray-07">Record</div>
              {emptyCount > 0 && (
                <button onClick={() => setShowEmpty(s => !s)} className="text-[11px] font-johnson-text text-jj-blue-03 underline">
                  {showEmpty ? 'Hide empty fields' : `Show ${emptyCount} empty fields`}
                </button>
              )}
            </div>
            {rows.map(([c, v]) => (
              <div key={c} className="flex text-xs font-johnson-text border-b border-jj-gray-01 last:border-0 py-2 gap-3">
                <div className="w-[36%] text-jj-gray-07 flex-shrink-0 break-words">{labelOf(c)}</div>
                <div className="w-[64%] text-jj-gray-08 break-words whitespace-pre-wrap max-h-[180px] overflow-y-auto ct-scroll">
                  {isEmpty(v) ? <span className="text-jj-gray-04">—</span>
                    : isUrl(v) ? <a href={v} target="_blank" rel="noreferrer" className="text-jj-blue-03 underline break-all">{v}</a>
                    : looksLikeDate(v) ? `${fmtDate(v)} · ${v}`
                    : show(v)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {isUrl(link) && (
          <div className="flex-shrink-0 px-5 py-3.5 border-t border-jj-gray-02 flex items-center gap-2">
            <a href={link} target="_blank" rel="noreferrer"
              className="flex-1 text-center px-[18px] py-[9px] rounded-full bg-jj-red text-white text-[12.5px] font-johnson-text font-medium hover:bg-[#c91400] transition-colors shadow-[0_2px_8px_rgba(235,23,0,.25)]">
              Open source ↗
            </a>
            <button onClick={copy} className="px-[18px] py-[9px] rounded-full border border-jj-gray-03 text-[12.5px] font-johnson-text text-jj-gray-08 hover:bg-jj-gray-01">
              {copied === 'fail' ? 'Copy blocked' : copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

/* ============================== tabs ============================== */

// one tab per Cortellis table, scrolls sideways when they don't fit
function TableTabs({ source, sources, onPick }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // bring the open table into view without scrolling the page itself
    const on = el.querySelector('[data-on="1"]');
    if (on) {
      const l = on.offsetLeft - 24, r = on.offsetLeft + on.offsetWidth + 24;
      if (l < el.scrollLeft) el.scrollLeft = l;
      else if (r > el.scrollLeft + el.clientWidth) el.scrollLeft = r - el.clientWidth;
    }
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [source.id]);
  const nudge = (dir) => ref.current?.scrollBy({ left: dir * Math.max(240, ref.current.clientWidth * 0.6), behavior: 'smooth' });
  const arrow = (dir) => (
    <button onClick={() => nudge(dir)} aria-label={dir < 0 ? 'Scroll tables left' : 'Scroll tables right'} title={dir < 0 ? 'More tables' : 'More tables'}
      className={`absolute top-1/2 -translate-y-1/2 ${dir < 0 ? 'left-0' : 'right-0'} z-[2] w-7 h-7 rounded-full bg-white border border-jj-gray-03 shadow-[0_2px_6px_rgba(49,44,42,.15)] flex items-center justify-center hover:border-jj-red/40`}>
      <Icon src={chevronRightIcon} tint="ink" className={`w-2.5 h-2.5 ${dir < 0 ? 'rotate-180' : ''}`} />
    </button>
  );
  return (
    <div className="relative flex-1 min-w-0">
      {edges.left && <><div className="absolute left-0 top-0 bottom-0 w-12 z-[1] pointer-events-none" style={{ background: 'linear-gradient(90deg, #faf9f8, rgba(250,249,248,0))' }} />{arrow(-1)}</>}
      {edges.right && <><div className="absolute right-0 top-0 bottom-0 w-12 z-[1] pointer-events-none" style={{ background: 'linear-gradient(270deg, #faf9f8, rgba(250,249,248,0))' }} />{arrow(1)}</>}
      <div ref={ref} onScroll={measure} className="flex items-center gap-1 overflow-x-auto ct-noscroll py-0.5" role="tablist" aria-label="Cortellis tables">
        {sources.map((s, i) => {
          const on = s.id === source.id;
          const c = PALETTE[i % PALETTE.length];
          return (
            <button key={s.id} role="tab" aria-selected={on} data-on={on ? '1' : '0'} onClick={() => !on && onPick(s.id)} title={`${s.label} · ${fmtNum(s.rows)} records`}
              className={`flex items-center gap-2 px-3 py-[6px] rounded-full border text-[12px] font-johnson-text whitespace-nowrap transition-all flex-shrink-0 ${on
                ? 'bg-white border-jj-gray-03 text-jj-gray-08 font-bold shadow-[0_1px_4px_rgba(49,44,42,.12)]'
                : 'bg-transparent border-transparent text-jj-gray-07 hover:bg-white hover:border-jj-gray-02 hover:text-jj-gray-08'}`}>
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c }} />
              {s.label}
              <span className={`text-[11px] tabular-nums px-1.5 rounded-full ${on ? 'bg-jj-red/10 text-[#c21300] font-bold' : 'bg-[#ece9e6] text-jj-gray-07'}`}>{compact(s.rows)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// section tabs under the table tabs, red underline on the active one
function SectionTabs({ tabs, value, onChange }) {
  return (
    <div className="flex items-end gap-1 overflow-x-auto ct-noscroll" role="tablist" aria-label="Sections">
      {tabs.map(t => {
        const on = t.id === value;
        return (
          <button key={t.id} role="tab" aria-selected={on} onClick={() => onChange(t.id)}
            className={`relative px-3.5 pt-2 pb-2.5 text-[13px] font-johnson-text whitespace-nowrap transition-colors ${on ? 'text-[#c21300] font-bold' : 'text-jj-gray-07 hover:text-jj-gray-08'}`}>
            {t.label}
            {t.badge != null && <span className={`ml-1.5 text-[10.5px] tabular-nums px-1.5 py-[1px] rounded-full ${on ? 'bg-jj-red/10 text-[#c21300]' : 'bg-[#ece9e6] text-jj-gray-07'}`}>{t.badge}</span>}
            <span className={`absolute left-2 right-2 bottom-0 h-[3px] rounded-t-full transition-all ${on ? 'bg-jj-red' : 'bg-transparent'}`} />
          </button>
        );
      })}
    </div>
  );
}

/* ============================== one table ============================== */

function TableView({ source, sources, onPick, activeTab, logInPage, onBusyChange, onSynced, canViewSql, reloadKey }) {
  const [params, setParams] = useSearchParams();
  const [meta, setMeta] = useState(null);
  const [metaError, setMetaError] = useState(null);
  const [metaAttempt, setMetaAttempt] = useState(0);
  const [overview, setOverview] = useState(null);
  const [ovError, setOvError] = useState(null);
  const [ovLoading, setOvLoading] = useState(false);
  const [ovAttempt, setOvAttempt] = useState(0);
  const [insights, setInsights] = useState(null);
  const [insError, setInsError] = useState(null);
  const [insLoading, setInsLoading] = useState(false);
  const [insAttempt, setInsAttempt] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [record, setRecord] = useState(null);

  // filters / search / years live in the URL, so a link reopens the same view
  const rawF = params.get('ctf') || '';
  const filters = useMemo(() => readFilters(rawF), [rawF]);
  const q = (params.get('ctq') || '').trim();
  const rawY = params.get('cty') || '';
  const years = useMemo(() => readYears(rawY), [rawY]);
  const state = { filters, q, years };
  const qs = filterParams(state).toString();

  // view changes replace history (no back-button spam) and send the records grid to page 1
  const setView = (patch) => setParams(prev => {
    const n = new URLSearchParams(prev);
    Object.entries(patch).forEach(([k, v]) => { if (v == null || v === '') n.delete(k); else n.set(k, v); });
    n.delete('ctp');
    return n;
  }, { replace: true });
  const setFilters = (f) => {
    const clean = Object.fromEntries(Object.entries(f).filter(([, v]) => v.length));
    setView({ ctf: Object.keys(clean).length ? JSON.stringify(clean) : null });
  };

  // search box types locally, writes to the URL after a pause, and follows the URL on back/forward
  const [query, setQuery] = useState(q);
  const typed = useDebounced(query.trim());
  const lastQ = useRef(q);
  useEffect(() => { if (q !== lastQ.current) { lastQ.current = q; setQuery(q); } }, [q]);
  useEffect(() => {
    if (typed === lastQ.current) return;
    lastQ.current = typed;
    setView({ ctq: typed || null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  useEffect(() => {
    let dead = false;
    const ctl = new AbortController(); // cancelled on leave so it stops holding a browser connection
    setMetaError(null);
    apiJson(`/api/cortellis/meta/${source.id}`, { signal: ctl.signal })
      .then(res => { if (!dead) setMeta(res); })
      .catch(e => { if (!dead && !isAbort(e)) setMetaError(e.message || String(e)); });
    return () => { dead = true; ctl.abort(); };
  }, [source.id, metaAttempt]);

  // overview feeds the rail counts and most charts
  useEffect(() => {
    let dead = false;
    setOvLoading(true); setOvError(null);
    const p = new URLSearchParams(qs);
    if (reloadKey) p.set('bypass_cache', 'true');
    // each piece replaces its old one as it lands, so a filter change updates card by card
    const ctl = new AbortController();
    apiStream(`/api/cortellis/overview/${source.id}?${p}`, part => { if (!dead) setOverview(prev => ({ ...prev, ...part, _done: false })); }, ctl.signal)
      .then(res => { if (!dead) { setOverview({ ...res, _done: true }); onSynced?.(Date.now()); } })
      .catch(e => { if (!dead && !isAbort(e)) setOvError(e.message || String(e)); })
      .finally(() => { if (!dead) setOvLoading(false); });
    return () => { dead = true; ctl.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.id, qs, reloadKey, ovAttempt]);

  // heatmap / leaders / numbers / completeness come separately so the main charts show first
  useEffect(() => {
    let dead = false;
    setInsLoading(true); setInsError(null);
    const p = new URLSearchParams(qs);
    if (reloadKey) p.set('bypass_cache', 'true');
    const ctl = new AbortController();
    apiStream(`/api/cortellis/insights/${source.id}?${p}`, part => { if (!dead) setInsights(prev => ({ ...prev, ...part, _done: false })); }, ctl.signal)
      .then(res => { if (!dead) setInsights({ ...res, _done: true }); })
      .catch(e => { if (!dead && !isAbort(e)) setInsError(e.message || String(e)); })
      .finally(() => { if (!dead) setInsLoading(false); });
    return () => { dead = true; ctl.abort(); };
  }, [source.id, qs, reloadKey, insAttempt]);

  // one busy flag for the page header, true while anything here is loading
  const busy = ovLoading || insLoading || tableLoading || (!meta && !metaError);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);

  const labelOf = (c) => meta?.labels?.[c] || niceCol(c);
  const facetColors = useMemo(() => Object.fromEntries((meta?.facets || []).map((c, i) => [c, PALETTE[i % PALETTE.length]])), [meta]);
  const onToggle = (col, value) => {
    const list = filters[col] || [];
    const on = list.includes(value);
    logInPage?.(on ? 'filter_remove' : 'filter_add', `Cortellis ${source.label}: ${on ? 'removed' : 'added'} ${labelOf(col)} "${value}"`);
    setFilters({ ...filters, [col]: on ? list.filter(v => v !== value) : [...list, value] });
  };
  const setYears = (y) => {
    logInPage?.('filter_years', `Cortellis ${source.label}: ${y ? `years ${y[0]}-${y[1]}` : 'all years'}`);
    setView({ cty: y ? `${y[0]}-${y[1]}` : null });
  };
  const searchFor = (v) => { lastQ.current = v; setQuery(v); setView({ ctq: v || null }); };
  const clearAll = () => { lastQ.current = ''; setQuery(''); setView({ ctf: null, ctq: null, cty: null }); };
  const openRecord = (r) => {
    logInPage?.('cortellis_record', `Opened Cortellis ${source.label} record "${String(r.title || r.key || '').slice(0, 80)}"`);
    setRecord(r);
  };

  // filters on columns this table doesn't have (old link) are ignored by the API, don't show them either
  const knownFilters = meta ? Object.fromEntries(Object.entries(filters).filter(([c]) => meta.facets.includes(c))) : filters;
  const chips = [
    ...Object.entries(knownFilters).flatMap(([c, vals]) => vals.map(v => ({ key: `${c}:${v}`, text: <><span className="text-jj-gray-07">{labelOf(c)}:</span> {v}</>, clear: () => onToggle(c, v) }))),
    ...(years ? [{ key: 'years', text: <><span className="text-jj-gray-07">{meta?.year_label || 'Year'}:</span> {years[0] === years[1] ? years[0] : `${years[0]}–${years[1]}`}</>, clear: () => setYears(null) }] : []),
    ...(q ? [{ key: 'q', text: <><span className="text-jj-gray-07">Search:</span> "{q}"</>, clear: () => searchFor('') }] : []),
  ];

  // section tabs, kept in ?cttab so links and back/forward work
  const tabs = [
    { id: 'overview', label: 'Overview' },
    ...(meta?.has_years !== false ? [{ id: 'trends', label: 'Trends' }] : []),
    { id: 'breakdowns', label: 'Breakdowns', badge: overview?.facets?.length },
    ...(!insights || insError || insights.cross?.cells?.length || insights.leaders?.values?.length ? [{ id: 'relationships', label: 'Relationships' }] : []),
    { id: 'numbers', label: insights?.measures?.some(m => m.count) ? 'Numbers & quality' : 'Data quality' },
    { id: 'records', label: 'Records', badge: overview?.total != null ? compact(overview.total) : null },
  ];
  const wanted = params.get('cttab') || (activeTab === 'table' ? 'records' : 'overview');
  const section = tabs.some(t => t.id === wanted) ? wanted : 'overview';
  const goTo = (id) => {
    if (id === section) return;
    logInPage?.('cortellis_tab', `Cortellis ${source.label}: opened ${tabs.find(t => t.id === id)?.label || id} tab`);
    setParams(prev => { const n = new URLSearchParams(prev); if (id === 'overview') n.delete('cttab'); else n.set('cttab', id); return n; }, { replace: false });
  };
  // a tab that turned out not to exist for this table (no dates, nothing to compare) -> drop it from the URL
  useEffect(() => {
    if (!meta || !insights) return;
    const t = params.get('cttab');
    if (t && !tabs.some(x => x.id === t)) setParams(prev => { const n = new URLSearchParams(prev); n.delete('cttab'); return n; }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, insights]);

  const header = (
    <div className="flex-shrink-0 bg-white/70 border-b border-jj-gray-02">
      <div className="px-5 pt-3 flex items-center gap-3 min-w-0">
        <button onClick={() => onPick(null)} title="Back to all Cortellis tables"
          className="flex items-center gap-1.5 pl-2 pr-3 py-[6px] rounded-full border border-jj-gray-03 bg-white text-[12px] font-johnson-text font-bold text-jj-gray-08 hover:border-jj-red/40 hover:text-[#c21300] transition-colors flex-shrink-0">
          <Icon src={chevronRightIcon} tint="ink" className="w-2.5 h-2.5 rotate-180" />Cortellis
        </button>
        <span className="w-px h-6 bg-jj-gray-03 flex-shrink-0" />
        <TableTabs source={source} sources={sources} onPick={onPick} />
      </div>
      <div className="px-5 pt-2 flex items-end justify-between gap-4 min-w-0">
        <SectionTabs tabs={tabs} value={section} onChange={goTo} />
        <div className="hidden lg:block text-right pb-2.5 min-w-0">
          {meta?.blurb && <div className="text-[12px] font-johnson-text text-jj-gray-07 truncate">{meta.blurb}</div>}
        </div>
      </div>
    </div>
  );

  if (metaError && !meta) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        {header}
        <div className="p-5"><LoadFailed what={`${source.label} (table layout)`} error={metaError} onRetry={() => setMetaAttempt(a => a + 1)} /></div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {header}
      <div className="flex-1 min-h-0 flex">
        <Rail meta={meta} overview={overview} error={ovError} filters={knownFilters} onToggle={onToggle} query={query} setQuery={setQuery}
          years={years} setYears={setYears} count={chips.length} clearAll={clearAll} labelOf={labelOf}
          collapsed={railCollapsed} setCollapsed={setRailCollapsed} />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden" aria-busy={busy}>
          <RefreshBar on={(ovLoading && !!overview) || (insLoading && !!insights && ['relationships', 'numbers'].includes(section))} />
          {ovError && (
            <div className="flex-shrink-0 px-5 pt-3">
              <LoadFailed what={overview ? 'the latest numbers (showing the last good load)' : 'the overview'} error={ovError} onRetry={() => setOvAttempt(a => a + 1)} />
            </div>
          )}
          {chips.length > 0 && (
            <div className="flex-shrink-0 px-5 pt-3 flex items-center gap-2 flex-wrap">
              {chips.map(c => (
                <span key={c.key} className="inline-flex items-center gap-1.5 pl-3 pr-2 py-[5px] rounded-full bg-jj-red/[.06] border border-jj-red/25 text-[12px] font-johnson-text text-jj-gray-08 max-w-[340px]">
                  <span className="truncate">{c.text}</span>
                  <button onClick={c.clear} title="Remove filter" className="hover:opacity-60 flex-shrink-0 p-0.5" aria-label="Remove filter"><Icon src={closeIcon} alt="Remove" tint="gray" className="w-2 h-2" /></button>
                </span>
              ))}
              <button onClick={clearAll} className="text-[11.5px] font-johnson-text text-jj-blue-03 underline">Clear all</button>
            </div>
          )}
          {!meta ? (
            <ExploreSkeleton />
          ) : section === 'records' ? (
            <DataTable meta={meta} state={state} labelOf={labelOf} logInPage={logInPage} onLoading={setTableLoading} onSynced={onSynced}
              canViewSql={canViewSql} reloadKey={reloadKey} openRecord={openRecord} facetColors={facetColors} />
          ) : (
            <Explore section={section} meta={meta} overview={overview} insights={insights} insightsError={insError}
              onRetryInsights={() => setInsAttempt(a => a + 1)} loading={ovLoading} error={ovError} state={state}
              onToggle={onToggle} setYears={setYears} setQuery={searchFor} labelOf={labelOf} openRecord={openRecord} clearAll={clearAll} goTo={goTo} />
          )}
        </div>
      </div>
      {record && meta && <RecordDrawer meta={meta} record={record} onClose={() => setRecord(null)} labelOf={labelOf} facetColors={facetColors} />}
    </div>
  );
}

/* ============================== main ============================== */

export default function CortellisExplorer({ activeTab = 'explore', logInPage, onBusyChange, onSynced, canViewSql, reloadKey }) {
  const [params, setParams] = useSearchParams();
  const [sources, setSources] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let dead = false;
    setError(null);
    // table cards come first, row counts follow on the next line
    const ctl = new AbortController();
    apiStream(`/api/cortellis/sources${reloadKey ? '?bypass_cache=true' : ''}`, part => { if (!dead) setSources(part.sources || []); }, ctl.signal)
      .catch(e => { if (!dead && !isAbort(e)) setError(e.message || String(e)); });
    return () => { dead = true; ctl.abort(); };
  }, [reloadKey, attempt]);

  const wantedId = params.get('ct');
  const active = (sources || []).find(s => s.id === wantedId) || null;
  const unknown = !!sources && !!wantedId && !active;
  // table list / errors have nothing loading. leaving Cortellis clears the flag too
  useEffect(() => { if (!active) onBusyChange?.(!sources && !error); }, [active, sources, error, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);

  // new table = fresh view: keep the section tab, drop filters / search / paging from the old one
  const pick = (id) => {
    const s = (sources || []).find(x => x.id === id);
    if (s) logInPage?.('cortellis_open', `Opened Cortellis table "${s.label}"`);
    setParams(prev => {
      const next = new URLSearchParams(prev);
      CT_VIEW_KEYS.forEach(k => next.delete(k));
      if (id) next.set('ct', id); else { next.delete('ct'); next.delete('cttab'); }
      return next;
    });
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <style>{STYLES}</style>
      <CortellisBoundary resetKey={`${wantedId}|${params.get('cttab')}`} onHome={() => pick(null)}>
        {error && !sources ? (
          <div className="p-5"><LoadFailed what="Cortellis tables" error={error} onRetry={() => setAttempt(a => a + 1)} /></div>
        ) : !sources ? (
          <PickerSkeleton />
        ) : !active ? (
          <>
            {unknown && (
              <div className="flex-shrink-0 px-5 pt-4">
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#fff7e6] border border-[#a35d00]/30 text-[12.5px] font-johnson-text text-[#7a4600]">
                  <Icon src={alertIcon} tint="ink" className="w-4 h-4 flex-shrink-0" />
                  <span className="flex-1">The table in this link (<b>{wantedId}</b>) isn't available. Pick one below.</span>
                  <button onClick={() => pick(null)} className="text-jj-blue-03 underline">Dismiss</button>
                </div>
              </div>
            )}
            {sources.length ? <Picker sources={sources} onPick={pick} /> : (
              <div className="p-5"><Empty title="No Cortellis tables are set up" sub="Add them to TABLES in backend/cortellis.py." /></div>
            )}
          </>
        ) : (
          <TableView key={active.id} source={active} sources={sources} onPick={pick} activeTab={activeTab} logInPage={logInPage}
            onBusyChange={onBusyChange} onSynced={onSynced} canViewSql={canViewSql} reloadKey={reloadKey} />
        )}
      </CortellisBoundary>
    </div>
  );
}