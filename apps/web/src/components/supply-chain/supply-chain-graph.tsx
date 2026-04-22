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

/**
 * Force-directed graph of the user's portfolio and its upstream / downstream
 * counterparties. Portfolio tickers render as filled accent circles;
 * counterparties as outline circles sized by how many portfolio tickers
 * depend on them. Edge colour encodes substitutability (LOW = red bottleneck).
 *
 * The force-graph is canvas-based and expects numeric width/height, so we
 * observe the container and feed the dimensions in. The canvas is
 * absolutely-positioned over the container so flex parents don't fight with
 * the intrinsic width.
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

  const graphData = useMemo(() => {
    const { nodes, links } = buildSupplyChainGraph({ maps, portfolioTickers });
    if (!bottlenecksOnly) return { nodes, links };

    // Keep only LOW / MEDIUM upstream edges + their endpoints. Hides the
    // noise of HIGH-substitutability and un-annotated edges so the user can
    // focus on where they are actually exposed.
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

  // Re-zoom to fit whenever the data shape changes.
  useEffect(() => {
    const id = setTimeout(() => {
      graphRef.current?.zoomToFit(400, 40);
    }, 300);
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
          drawNode({ ...node, x: node.x, y: node.y }, ctx, scale, focusedNodeId === node.id);
        }}
        linkColor={(l) => substitutabilityColor((l as unknown as GraphLink).substitutability)}
        linkWidth={(l) => linkWidth(l as unknown as GraphLink)}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={0.9}
        linkCurvature={(l) => ((l as unknown as GraphLink).kind === 'downstream' ? 0.2 : 0)}
        cooldownTicks={200}
        d3AlphaDecay={0.03}
        onNodeClick={(n) => onNodeClick?.(n as GraphNode)}
      />
    </div>
  );
}

function nodeSize(node: GraphNode): number {
  if (node.kind === 'portfolio') return 12;
  // Counterparty size scales with how many portfolio tickers lean on it —
  // a TSMC-style hub visually dominates a one-off supplier.
  return 4 + Math.min(node.portfolioDegree * 3, 14);
}

function linkWidth(l: GraphLink): number {
  // Lean harder on criticality for upstream, sharePct for downstream.
  if (l.kind === 'upstream') return 0.5 + l.criticality * 2.5;
  if (l.sharePct != null) return 0.5 + Math.min(l.sharePct / 10, 2);
  return 0.75;
}

function drawNode(
  node: GraphNode & { x: number; y: number },
  ctx: CanvasRenderingContext2D,
  scale: number,
  focused: boolean,
): void {
  const r = nodeSize(node);

  // Portfolio vs counterparty fill.
  ctx.beginPath();
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
  if (node.kind === 'portfolio') {
    ctx.fillStyle = '#2563eb'; // blue-600 — portfolio anchor
  } else if (node.bottleneck) {
    ctx.fillStyle = '#ef4444'; // red-500 — single point of failure
  } else if (node.shared) {
    ctx.fillStyle = '#f59e0b'; // amber-500 — shared hub
  } else {
    ctx.fillStyle = 'rgba(100, 116, 139, 0.55)'; // slate translucent
  }
  ctx.fill();

  // Focus / bottleneck ring.
  if (focused || node.bottleneck) {
    ctx.lineWidth = 2 / scale;
    ctx.strokeStyle = focused ? '#22d3ee' : '#fecaca';
    ctx.stroke();
  }

  // Label — only draw once the view is zoomed in enough to read.
  const fontSize = Math.max(10 / scale, 3);
  if (scale > 0.9 || node.kind === 'portfolio' || node.shared || node.bottleneck) {
    ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(truncate(node.label, 24), node.x, node.y + r + 2);
  }
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
