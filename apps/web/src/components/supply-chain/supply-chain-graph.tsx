import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';

import type { Substitutability, SupplyChainMap } from '../../api/types';
import {
  buildSupplyChainGraph,
  substitutabilityColor,
  type GraphLink,
  type GraphNode,
} from '../../lib/supply-chain-graph';

interface SupplyChainGraphProps {
  maps: SupplyChainMap[];
  portfolioTickers: string[];
  /** When true, hides edges annotated HIGH or null — keeps bottlenecks visible. */
  bottlenecksOnly?: boolean;
  /** Callback fired when the user clicks a node (for side-panel focus). */
  onNodeClick?: (node: GraphNode) => void;
  /** Currently focused node id, if any — renders highlighted. */
  focusedNodeId?: string | null;
}

interface ThemeColors {
  textPrimary: string;
  textMuted: string;
  bgCard: string;
  border: string;
}

const DEFAULT_THEME: ThemeColors = {
  textPrimary: '#f5f5f4',
  textMuted: '#737373',
  bgCard: '#262626',
  border: '#3d3d3d',
};

/**
 * Force-directed graph of the user's portfolio and its upstream / downstream
 * counterparties. Portfolio tickers render as filled accent circles;
 * counterparties as outline circles sized by how many portfolio tickers
 * depend on them. Edge colour encodes substitutability (LOW = red bottleneck).
 */
export function SupplyChainGraph({
  maps,
  portfolioTickers,
  bottlenecksOnly = false,
  onNodeClick,
  focusedNodeId,
}: SupplyChainGraphProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 600, h: 480 });
  const [theme, setTheme] = useState<ThemeColors>(DEFAULT_THEME);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setSize({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Read theme tokens from CSS vars so canvas colors follow light/dark.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const read = () => {
      const s = getComputedStyle(el);
      setTheme({
        textPrimary: s.getPropertyValue('--color-text-primary').trim() || DEFAULT_THEME.textPrimary,
        textMuted: s.getPropertyValue('--color-text-muted').trim() || DEFAULT_THEME.textMuted,
        bgCard: s.getPropertyValue('--color-bg-card').trim() || DEFAULT_THEME.bgCard,
        border: s.getPropertyValue('--color-border').trim() || DEFAULT_THEME.border,
      });
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const graphData = useMemo(() => {
    const { nodes, links } = buildSupplyChainGraph({ maps, portfolioTickers });
    if (!bottlenecksOnly) return { nodes, links };
    const keptLinks = links.filter(
      (l) => l.kind === 'upstream' && (l.substitutability === 'LOW' || l.substitutability === 'MEDIUM'),
    );
    const keep = new Set<string>();
    for (const l of keptLinks) {
      keep.add(typeof l.source === 'string' ? l.source : (l.source as GraphNode).id);
      keep.add(typeof l.target === 'string' ? l.target : (l.target as GraphNode).id);
    }
    return {
      nodes: nodes.filter((n) => keep.has(n.id) || n.kind === 'portfolio'),
      links: keptLinks,
    };
  }, [maps, portfolioTickers, bottlenecksOnly]);

  // Tune the d3 forces once the graph is mounted: more repulsion + longer
  // link distance so counterparties don't collapse into flower clusters and
  // portfolio anchors repel each other enough to span the canvas.
  useEffect(() => {
    const g = graphRef.current;
    if (!g) return;
    const charge = g.d3Force('charge');
    charge?.strength(-380).distanceMax(450);
    const link = g.d3Force('link');
    link?.distance(90);
  }, [graphData]);

  // Re-zoom to fit once the layout has had time to settle.
  useEffect(() => {
    const id = setTimeout(() => {
      graphRef.current?.zoomToFit(500, 50);
    }, 1200);
    return () => clearTimeout(id);
  }, [graphData]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      <ForceGraph2D
        ref={graphRef}
        graphData={graphData}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        nodeId="id"
        nodeLabel={(n) => nodeTooltip(n as GraphNode)}
        linkLabel={(l) => linkTooltip(l as unknown as GraphLink)}
        nodeVal={(n) => nodeSize(n as GraphNode)}
        nodeCanvasObjectMode={() => 'after'}
        nodeCanvasObject={(rawNode, ctx, scale) => {
          const node = rawNode as GraphNode & { x?: number; y?: number };
          if (node.x == null || node.y == null) return;
          drawNode({ ...node, x: node.x, y: node.y }, ctx, scale, focusedNodeId === node.id, theme);
        }}
        linkColor={(l) => substitutabilityColor((l as unknown as GraphLink).substitutability)}
        linkWidth={(l) => linkWidth(l as unknown as GraphLink)}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={0.92}
        linkCurvature={(l) => ((l as unknown as GraphLink).kind === 'downstream' ? 0.2 : 0)}
        cooldownTicks={300}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        onNodeClick={(n) => onNodeClick?.(n as GraphNode)}
      />
    </div>
  );
}

function nodeSize(node: GraphNode): number {
  if (node.kind === 'portfolio') return 14;
  return 4 + Math.min(node.portfolioDegree * 3, 16);
}

function linkWidth(l: GraphLink): number {
  if (l.kind === 'upstream') return 0.5 + l.criticality * 2.5;
  if (l.sharePct != null) return 0.5 + Math.min(l.sharePct / 10, 2);
  return 0.75;
}

function drawNode(
  node: GraphNode & { x: number; y: number },
  ctx: CanvasRenderingContext2D,
  scale: number,
  focused: boolean,
  theme: ThemeColors,
): void {
  const r = nodeSize(node);

  // Node fill.
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  if (node.kind === 'portfolio') {
    ctx.fillStyle = '#2563eb';
  } else if (node.bottleneck) {
    ctx.fillStyle = '#ef4444';
  } else if (node.shared) {
    ctx.fillStyle = '#f59e0b';
  } else {
    ctx.fillStyle = 'rgba(100, 116, 139, 0.75)';
  }
  ctx.fill();

  // Outline every node to carve it out of overlapping siblings.
  ctx.lineWidth = (node.kind === 'portfolio' ? 2 : 1) / scale;
  ctx.strokeStyle = theme.bgCard;
  ctx.stroke();

  // Focus / bottleneck ring — drawn on top of the outline.
  if (focused || node.bottleneck) {
    ctx.beginPath();
    ctx.arc(node.x, node.y, r + 2 / scale, 0, Math.PI * 2);
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = focused ? '#22d3ee' : '#fca5a5';
    ctx.stroke();
  }

  // Label — always visible for portfolio / shared / bottleneck / focused;
  // counterparty labels show once the view is legibly zoomed.
  const shouldLabel = node.kind === 'portfolio' || node.shared || node.bottleneck || focused || scale > 1.4;
  if (!shouldLabel) return;

  const fontSize = Math.max((node.kind === 'portfolio' ? 12 : 10) / scale, 2.5);
  ctx.font = `${node.kind === 'portfolio' ? '600 ' : ''}${fontSize}px Inter, system-ui, sans-serif`;
  const label = truncate(node.label, 22);
  const metrics = ctx.measureText(label);
  const padX = 3 / scale;
  const padY = 1.5 / scale;
  const boxW = metrics.width + padX * 2;
  const boxH = fontSize + padY * 2;
  const boxX = node.x - boxW / 2;
  // Portfolio labels sit above the node, counterparty labels below. This
  // halves the amount of label collision because the two families occupy
  // different vertical bands around each node.
  const boxY = node.kind === 'portfolio' ? node.y - r - 3 / scale - boxH : node.y + r + 3 / scale;

  // Pill is the inverse of the text-primary token. On light theme text is
  // dark → pill goes dark/high-contrast with white text. On dark theme text
  // is light → pill goes near-white with dark text. Either way the label
  // reads cleanly against the canvas.
  const themeTextIsLight = isColorLight(theme.textPrimary);
  roundRect(ctx, boxX, boxY, boxW, boxH, 2 / scale);
  ctx.fillStyle = themeTextIsLight ? 'rgba(245, 245, 244, 0.92)' : 'rgba(23, 23, 23, 0.88)';
  ctx.fill();

  ctx.fillStyle = themeTextIsLight ? '#171717' : '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, node.x, boxY + boxH / 2);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function isColorLight(color: string): boolean {
  const hex = color.trim();
  if (!hex.startsWith('#')) return false;
  let r: number;
  let g: number;
  let b: number;
  if (hex.length === 4) {
    r = parseInt(hex.charAt(1).repeat(2), 16);
    g = parseInt(hex.charAt(2).repeat(2), 16);
    b = parseInt(hex.charAt(3).repeat(2), 16);
  } else if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  } else {
    return false;
  }
  return 0.299 * r + 0.587 * g + 0.114 * b > 140;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function nodeTooltip(n: GraphNode): string {
  const parts: string[] = [`<strong>${escape(n.label)}</strong>`];
  if (n.kind === 'counterparty') {
    parts.push(`Dependents: ${n.portfolioDegree}`);
    if (n.country) parts.push(`Origin: ${n.country}`);
    if (n.worstSubstitutability) parts.push(`Worst subst: ${n.worstSubstitutability}`);
    if (n.bottleneck) parts.push('⚠ Single point of failure');
    if (n.shared) parts.push('★ Shared hub');
  } else {
    parts.push('Portfolio ticker');
  }
  return parts.join('<br/>');
}

function linkTooltip(l: GraphLink): string {
  const label =
    l.kind === 'upstream'
      ? `Supplier — criticality ${l.criticality.toFixed(2)}`
      : `Customer${l.sharePct != null ? ` — ${l.sharePct}% of revenue` : ''}`;
  const subst = l.substitutability ? ` · ${substLabel(l.substitutability)}` : '';
  const country = l.originCountry ? ` · ${l.originCountry}` : '';
  return `${label}${subst}${country}`;
}

function substLabel(s: Substitutability): string {
  return s === 'LOW' ? 'irreplaceable' : s === 'MEDIUM' ? 'some alternatives' : 'commoditised';
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
