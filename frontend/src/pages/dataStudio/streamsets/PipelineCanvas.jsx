import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, Handle, Position, MarkerType, MiniMap, useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { kindOf, canvasLayout, stageSubtitle, lineage, techMeta, NODE_W } from './streamsetsModel';

const FIT = { padding: 0.12, maxZoom: 1, minZoom: 0.55, duration: 0 };   // never fit so small the text can't be read
const FIT_STUDIO = { padding: 0.06, maxZoom: 1.15, minZoom: 0.7, duration: 0 };   // Pipeline Studio: bigger, starts at the source if long
const BAND_PAD = 12, BAND_HEAD = 54;   // step bands drawn behind each column (studio)

// What a column does, from the stages in it: Read / Transform / Fragment / Write / Finish.
function bandLabel(stages) {
  const kinds = new Set(stages.map(s => (s.fragment ? 'FRAG' : s.kind)));
  const main = [...kinds].filter(k => k !== 'EXECUTOR');
  if (!main.length) return 'Finish';
  if (main.every(k => k === 'SOURCE')) return 'Read';
  if (main.every(k => k === 'TARGET')) return kinds.has('EXECUTOR') ? 'Write & finish' : 'Write';
  if (main.every(k => k === 'FRAG')) return 'Fragment';
  return 'Transform';
}

function BandNode({ data }) {
  return (
    <div className="ss-band-col" aria-hidden="true">
      <div className="ss-band-h"><b>{data.n}</b><span>{data.label}</span><em>{data.count} stage{data.count === 1 ? '' : 's'}</em></div>
    </div>
  );
}

// Kind glyphs for stages StreamSets runs itself (no outside technology to show).
const KIND_GLYPH = {
  src: <path d="M3 4.5h10M3 8h10M3 11.5h6" />,
  proc: <path d="M2.5 8h3l1.5-3.5 2 7 1.5-3.5h3" />,
  dst: <path d="M8 2.5v8m-3.5-3.5L8 10.5 11.5 7M3 13.5h10" />,
  exe: <path d="M5 3.5v9l7-4.5-7-4.5Z" />,
  frag: <path d="M3 3h4v4H3zM9 9h4v4H9zM7 5h2.5a1.5 1.5 0 0 1 1.5 1.5V9" />,
};
const EDGE = { data: '#bdb5ad', event: '#c7b9ad', hot: '#eb1700' };
const handleStyle = { width: 9, height: 9, background: '#ffffff', border: '2px solid #d5cfc9' };

// Hover tracing lights up everything a stage feeds and is fed by. It re-draws every node, so it waits for
// the pointer to settle (sweeping across the canvas costs nothing) and stays off on very big pipelines.
const MAX_TRACE_NODES = 120;
const TRACE_DELAY_MS = 90;
const traceable = (layout) => layout.nodes.length <= MAX_TRACE_NODES;

function StageNode({ data }) {
  const { stage, selected, live, dim, lit, summary, studio } = data;
  const k = kindOf(stage);
  return (
    <div className={`ss-node ss-k-${k.cls}${selected ? ' is-sel' : ''}${dim ? ' is-dim' : ''}${lit ? ' is-lit' : ''}`} title={summary}>
      <Handle type="target" position={Position.Left} style={handleStyle} isConnectable={false} />
      <span className="ss-node-bar" />
      <div className="ss-node-in">
        <Tile tech={stage.technology} kind={studio ? k : null} />
        <div className="ss-node-txt">
          <div className="ss-klabel">{k.label}</div>
          <div className="ss-node-lb">{stage.label}</div>
          <div className="ss-node-sub">{stageSubtitle(stage)}</div>
        </div>
        {live && <span className="ss-live-dot" aria-label="Extracting" />}
      </div>
      <Handle type="source" position={Position.Right} style={handleStyle} isConnectable={false} />
    </div>
  );
}

function FragmentNode({ data }) {
  const { stage, selected, expanded, onToggle, onSelect, selectedPath, dim, lit, summary, summaries } = data;
  const frag = stage.fragment;
  const inner = frag.stages || [];
  const fragHandle = { ...handleStyle, top: 50, borderColor: '#c9a5e3' };
  return (
    <div className={`ss-node ss-node-frag ss-k-frag${selected ? ' is-sel' : ''}${dim ? ' is-dim' : ''}${lit ? ' is-lit' : ''}`} title={summary}>
      <Handle type="target" position={Position.Left} style={fragHandle} isConnectable={false} />
      <div className="ss-node-in ss-node-in-frag">
        <Tile tech="Fragment" />
        <div className="ss-node-txt">
          <div className="ss-klabel">Fragment{frag.version ? ` · v${String(frag.version).replace(/^v/i, '')}` : ''}</div>
          <div className="ss-node-lb">{stage.label}</div>
          <div className="ss-node-sub">{frag.name}</div>
        </div>
      </div>
      {frag.error ? (
        <div className="ss-frag-err" title={frag.error}>Couldn&apos;t load its steps</div>
      ) : (
        <button type="button" className="ss-frag-toggle nodrag nopan" aria-expanded={expanded}
          onClick={(e) => { e.stopPropagation(); onToggle(stage.instance); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
          {expanded ? 'Hide' : 'Show'} {inner.length} step{inner.length === 1 ? '' : 's'} inside
        </button>
      )}
      {expanded && !frag.error && (
        <div className="ss-frag-inner nodrag nopan">
          {inner.length === 0 && <div className="ss-muted">No steps</div>}
          {inner.map((s, i) => {
            const path = `${stage.instance}/${s.instance}`;
            return (
              <button key={s.instance} type="button" title={summaries?.get(path)}
                className={`ss-k-${kindOf(s).cls}${selectedPath === path ? ' is-sel' : ''}`}
                onClick={(e) => { e.stopPropagation(); onSelect(path); }}>
                <span className="ss-step-n">{i + 1}</span>
                <Tile tech={s.technology} small />
                <span className="ss-frag-inner-lb">{s.label}</span>
                <small>{s.fragment ? 'Fragment' : s.type_name}</small>
              </button>
            );
          })}
        </div>
      )}
      <Handle type="source" position={Position.Right} style={fragHandle} isConnectable={false} />
    </div>
  );
}

// Same coloured technology mark the pane draws (styles live in the pane's stylesheet).
// In Pipeline Studio (kind given) a stage StreamSets runs itself shows its kind's colour and glyph, not a red "SS".
function Tile({ tech, small = false, kind = null }) {
  const { color, mark } = techMeta(tech);
  if (kind && mark === 'SS' && !small) {
    return (
      <span className="ss-tile ss-tile-kind" style={{ '--t': kind.color }} aria-hidden="true">
        <svg viewBox="0 0 16 16">{KIND_GLYPH[kind.cls] || KIND_GLYPH.proc}</svg>
      </span>
    );
  }
  return <span className={`ss-tile${small ? ' ss-tile-sm' : ''}`} style={{ '--t': color }} aria-hidden="true">{mark}</span>;
}

const nodeTypes = { stage: memo(StageNode), fragment: memo(FragmentNode), band: memo(BandNode) };
const MINI_COLOR = { src: '#328714', proc: '#0f68b2', dst: '#d9620f', exe: '#81766f', frag: '#8c3bbb' };

function Canvas({ detail, selectedPath, onSelect, live, summaries, variant }) {
  const studio = variant === 'studio';
  const fitOpts = studio ? FIT_STUDIO : FIT;
  const [expanded, setExpanded] = useState(() => new Set());
  const [hover, setHover] = useState(null);
  const hoverTimer = useRef(0);
  const [zoom, setZoom] = useState(1);
  const { fitView, zoomIn, zoomOut, getViewport, setViewport } = useReactFlow();
  const selectedTop = (selectedPath || '').split('/')[0];

  const toggle = useCallback((id) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }), []);

  // A stage picked inside a fragment (list, parameter, link) opens that fragment here.
  useEffect(() => {
    if (!selectedPath || !selectedPath.includes('/')) return;
    setExpanded(prev => (prev.has(selectedTop) ? prev : new Set(prev).add(selectedTop)));
  }, [selectedPath, selectedTop]);

  const layout = useMemo(() => canvasLayout(detail.stages, expanded, studio ? { colGap: 56 } : undefined), [detail.stages, expanded, studio]);
  const traced = useMemo(() => (hover && traceable(layout) ? lineage(layout.edges, hover) : null), [hover, layout]);
  const hoverOn = useCallback((id) => {
    clearTimeout(hoverTimer.current);
    if (traceable(layout)) hoverTimer.current = setTimeout(() => setHover(id), TRACE_DELAY_MS);
  }, [layout]);
  const hoverOff = useCallback(() => { clearTimeout(hoverTimer.current); setHover(null); }, []);
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // Studio: a numbered band behind every column, as tall as the tallest column, saying what that step does.
  const bands = useMemo(() => {
    if (!studio || !layout.nodes.length) return [];
    const top = Math.min(...layout.nodes.map(n => n.y));
    const bottom = Math.max(...layout.nodes.map(n => n.y + n.h));
    const cols = new Map();
    layout.nodes.forEach(n => (cols.get(n.col) || cols.set(n.col, []).get(n.col)).push(n));
    return [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([c, ns], i) => ({
      id: `band:${c}`, type: 'band', zIndex: -1, draggable: false, selectable: false, focusable: false,
      position: { x: ns[0].x - BAND_PAD, y: top - BAND_HEAD },
      width: NODE_W + BAND_PAD * 2, height: bottom - top + BAND_HEAD + BAND_PAD,
      style: { width: NODE_W + BAND_PAD * 2, height: bottom - top + BAND_HEAD + BAND_PAD, pointerEvents: 'none' },
      data: { n: i + 1, label: bandLabel(ns.map(x => x.stage)), count: ns.length },
    }));
  }, [studio, layout]);

  const stageNodes = useMemo(() => layout.nodes.map(n => ({
    id: n.id,
    type: n.stage.fragment ? 'fragment' : 'stage',
    position: { x: n.x, y: n.y },
    width: n.w,
    height: n.h,
    style: { width: n.w, height: n.h, '--ss-d': `${Math.min(n.col, 8) * 70}ms` },
    draggable: false,
    selectable: false,
    data: {
      stage: n.stage,
      selected: selectedTop === n.id && !selectedPath.includes('/'),
      expanded: expanded.has(n.id),
      selectedPath,
      live,
      dim: !!traced && !traced.has(n.id),
      lit: !!traced && traced.has(n.id),
      summary: summaries?.get(n.id),
      summaries,
      onToggle: toggle,
      onSelect,
      studio,
    },
  })), [layout, selectedTop, selectedPath, expanded, live, traced, summaries, toggle, onSelect, studio]);
  const nodes = useMemo(() => (bands.length ? [...bands, ...stageNodes] : stageNodes), [bands, stageNodes]);

  const edges = useMemo(() => layout.edges.map(e => {
    const hot = (selectedTop && (e.source === selectedTop || e.target === selectedTop)) || (traced && traced.has(e.source) && traced.has(e.target));
    const faded = traced && !hot;
    const color = hot ? EDGE.hot : EDGE[e.kind];
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'default',
      // Moving dashes repaint every frame - only worth it while this pipeline is actually being extracted.
      animated: live && e.kind === 'data',
      label: e.kind === 'event' ? 'event' : undefined,
      labelStyle: { fontSize: 10, fill: '#6e6259', fontWeight: 700, letterSpacing: '.05em' },
      labelBgStyle: { fill: '#faf9f7', stroke: '#d5cfc9' },
      labelBgPadding: [6, 2],
      labelBgBorderRadius: 8,
      style: { stroke: color, strokeWidth: hot ? 2.2 : 1.7, strokeDasharray: e.kind === 'event' ? '5 5' : undefined, opacity: faded ? 0.18 : 1 },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 15, height: 15 },
      zIndex: hot ? 1 : 0,
      className: studio && hot ? 'is-hot' : undefined,
    };
  }), [layout, selectedTop, traced, live, studio]);

  // Keep the pipeline fitted as the space changes (stage panel, run panel, window size, a fragment
  // opening) - until the user pans or zooms, after which the view is theirs.
  const wrapRef = useRef(null);
  const userMoved = useRef(false);
  const contentWidth = useMemo(() => Math.max(0, ...layout.nodes.map(n => n.x + n.w)), [layout]);
  // A pipeline too long to fit at a readable zoom starts at its source instead of being cut off at both ends.
  const fit = useCallback(() => Promise.resolve(fitView(fitOpts)).then(() => {
    const vp = getViewport();
    const width = wrapRef.current?.clientWidth || 0;
    if (width && contentWidth * vp.zoom + 48 > width) setViewport({ x: 24, y: vp.y, zoom: vp.zoom });
    setZoom(vp.zoom);
  }), [fitView, getViewport, setViewport, contentWidth, fitOpts]);
  const refit = useCallback(() => { if (!userMoved.current) fit(); }, [fit]);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    let frame = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refit); });
    ro.observe(el);
    return () => { cancelAnimationFrame(frame); ro.disconnect(); };
  }, [refit]);
  useEffect(() => {
    const frame = requestAnimationFrame(refit);
    return () => cancelAnimationFrame(frame);
  }, [layout, refit]);
  const fitNow = () => { userMoved.current = false; fit(); };

  const fragmentIds = useMemo(() => detail.stages.filter(s => s.fragment && !s.fragment.error).map(s => s.instance), [detail.stages]);
  const allOpen = fragmentIds.length > 0 && fragmentIds.every(id => expanded.has(id));

  return (
    <div ref={wrapRef} className={`ss-canvas${live ? ' is-live' : ''}${studio ? ' is-studio' : ''}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => node.type !== 'band' && onSelect(node.id)}
        onNodeMouseEnter={(_, node) => node.type !== 'band' && hoverOn(node.id)}
        onNodeMouseLeave={hoverOff}
        onPaneClick={() => selectedPath && onSelect(selectedPath)}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onlyRenderVisibleElements
        minZoom={0.2}
        maxZoom={1.6}
        zoomOnDoubleClick={false}
        onMoveStart={(event) => { if (event) userMoved.current = true; }}
        onMoveEnd={(_, vp) => setZoom(vp.zoom)}
        fitView
        fitViewOptions={fitOpts}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={studio ? 20 : 22} size={studio ? 1.2 : 1.1} color={studio ? '#d9d2cb' : '#ddd7d1'} />
        {studio && layout.nodes.length > 4 && (
          <MiniMap className="ss-minimap" pannable zoomable ariaLabel="Overview of the whole pipeline"
            nodeColor={(n) => (n.type === 'band' ? 'transparent' : MINI_COLOR[kindOf(n.data.stage).cls] || '#a39992')}
            nodeBorderRadius={6} maskColor="rgba(244, 241, 237, .72)" nodeStrokeWidth={0} />
        )}
      </ReactFlow>

      <div className="ss-cv-tools">
        <div className="ss-cv-group">
          <button type="button" aria-label="Zoom out" onClick={() => { userMoved.current = true; zoomOut({ duration: 150 }); }}>−</button>
          <span className="ss-cv-zoom">{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Zoom in" onClick={() => { userMoved.current = true; zoomIn({ duration: 150 }); }}>+</button>
          <button type="button" onClick={fitNow}>Fit</button>
        </div>
        {fragmentIds.length > 0 && (
          <div className="ss-cv-group">
            <button type="button" onClick={() => { userMoved.current = false; setExpanded(allOpen ? new Set() : new Set(fragmentIds)); }}>
              {allOpen ? 'Close fragments' : 'Open fragments'}
            </button>
          </div>
        )}
      </div>

      <div className="ss-legend" aria-hidden="true">
        <span className="ss-k-src"><i />Source</span><span className="ss-k-proc"><i />Transform</span><span className="ss-k-frag"><i />Fragment</span>
        <span className="ss-k-dst"><i />Destination</span><span className="ss-k-exe"><i />Executor</span>
        <span><svg width="22" height="6"><path d="M0 3h22" stroke={EDGE.event} strokeWidth="1.6" strokeDasharray="4 3" /></svg>Event</span>
      </div>
      <div className="ss-cv-hint">Hover a stage to trace its data · scroll to zoom · drag to pan · click for details</div>
    </div>
  );
}

export default function PipelineCanvas(props) {
  return (
    <ReactFlowProvider>
      <Canvas {...props} />
    </ReactFlowProvider>
  );
}
