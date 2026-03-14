"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

// ============================================
// Types
// ============================================

interface FileOp {
  path: string;
  operation: "create" | "modify" | "delete" | "read";
  timestamp: number;
  success: boolean;
  step: number;
}

interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  isDir: boolean;
  depth: number;
  lastOp: FileOp["operation"] | null;
  lastOpTime: number;
  opCount: number;
  deleted: boolean;
  size: number; // visual size
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string;
  target: string;
}

interface FileTreeGraphProps {
  entries: Array<{
    type: string;
    toolCall?: { name?: string; arguments?: Record<string, unknown>; toolCallId?: string };
    toolName?: string;
    toolCallId?: string;
    success?: boolean;
    timestamp?: string;
    stepNumber?: number;
  }>;
  workingDirectory?: string;
}

// ============================================
// Colors
// ============================================

const OP_COLORS: Record<string, string> = {
  create: "#34d399",  // emerald-400
  modify: "#fbbf24",  // amber-400
  delete: "#f87171",  // red-400
  read: "#22d3ee",    // cyan-400
};

const OP_GLOW: Record<string, string> = {
  create: "rgba(52, 211, 153, 0.4)",
  modify: "rgba(251, 191, 36, 0.3)",
  delete: "rgba(248, 113, 113, 0.3)",
  read: "rgba(34, 211, 238, 0.15)",
};

function extColor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts": case "tsx": return "#3b82f6";
    case "js": case "jsx": return "#eab308";
    case "json": return "#8b5cf6";
    case "css": return "#ec4899";
    case "md": return "#6b7280";
    case "html": return "#f97316";
    default: return "#71717a";
  }
}

// ============================================
// Extract file events
// ============================================

function extractOps(entries: FileTreeGraphProps["entries"], workDir: string): FileOp[] {
  const ops: FileOp[] = [];
  const results = new Map<string, boolean>();

  for (const e of entries) {
    if (e.type === "tool_result" && e.toolCallId != null) {
      results.set(e.toolCallId, e.success ?? false);
    }
  }

  for (const e of entries) {
    if (e.type !== "tool_call" || !e.toolCall) continue;
    const name = e.toolCall.name;
    const path = e.toolCall.arguments?.path as string | undefined;
    if (!path) continue;

    let op: FileOp["operation"] | null = null;
    if (name === "write_file") op = "create";
    else if (name === "edit_file") op = "modify";
    else if (name === "delete_file") op = "delete";
    else if (name === "read_file") op = "read";
    if (!op) continue;

    let rel = path;
    if (rel.startsWith(workDir)) rel = rel.slice(workDir.length);
    if (rel.startsWith("/")) rel = rel.slice(1);
    if (!rel) continue;

    const tid = e.toolCall.toolCallId;
    const success = tid ? (results.get(tid) ?? true) : true;

    ops.push({
      path: rel,
      operation: op,
      timestamp: e.timestamp ? new Date(e.timestamp).getTime() : Date.now(),
      success,
      step: e.stepNumber ?? 0,
    });
  }

  return ops;
}

// ============================================
// Build graph data from ops
// ============================================

function buildGraph(ops: FileOp[]): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];

  // Ensure root
  nodeMap.set(".", {
    id: ".",
    name: "project",
    isDir: true,
    depth: 0,
    lastOp: null,
    lastOpTime: 0,
    opCount: 0,
    deleted: false,
    size: 18,
  });

  for (const op of ops) {
    if (!op.success) continue;

    const parts = op.path.split("/");

    // Build directory chain
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join("/");
      const parentPath = i === 0 ? "." : parts.slice(0, i).join("/");

      if (!nodeMap.has(dirPath)) {
        nodeMap.set(dirPath, {
          id: dirPath,
          name: parts[i],
          isDir: true,
          depth: i + 1,
          lastOp: null,
          lastOpTime: 0,
          opCount: 0,
          deleted: false,
          size: 14,
        });
        links.push({ source: parentPath, target: dirPath });
      }
    }

    // Add file node
    const filePath = op.path;
    const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
    const fileName = parts[parts.length - 1];

    if (!nodeMap.has(filePath)) {
      nodeMap.set(filePath, {
        id: filePath,
        name: fileName,
        isDir: false,
        depth: parts.length,
        lastOp: op.operation,
        lastOpTime: op.timestamp,
        opCount: 1,
        deleted: op.operation === "delete",
        size: 8,
      });
      links.push({ source: parentPath, target: filePath });
    } else {
      const node = nodeMap.get(filePath)!;
      if (op.operation === "create" && node.opCount > 0) {
        node.lastOp = "modify";
      } else {
        node.lastOp = op.operation;
      }
      node.lastOpTime = op.timestamp;
      node.opCount++;
      node.deleted = op.operation === "delete";
    }
  }

  return { nodes: Array.from(nodeMap.values()), links };
}

// ============================================
// Particle system for active operations
// ============================================

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

// ============================================
// Component
// ============================================

export default function FileTreeGraph({ entries, workingDirectory }: FileTreeGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const linksRef = useRef<GraphLink[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const frameRef = useRef<number>(0);
  const [dimensions, setDimensions] = useState({ width: 288, height: 400 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const prevOpsCountRef = useRef(0);
  const particleIdRef = useRef(0);

  const workDir = (workingDirectory || "").replace(/\/$/, "") + "/";
  const ops = useMemo(() => extractOps(entries, workDir), [entries, workDir]);
  const { nodes, links } = useMemo(() => buildGraph(ops), [ops]);

  // Track dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.floor(width), height: Math.floor(height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Spawn particles on new operations
  useEffect(() => {
    if (ops.length > prevOpsCountRef.current) {
      const newOps = ops.slice(prevOpsCountRef.current);
      for (const op of newOps) {
        if (!op.success || op.operation === "read") continue;
        const node = nodesRef.current.find((n) => n.id === op.path);
        if (node && node.x != null && node.y != null) {
          for (let i = 0; i < 6; i++) {
            const angle = (Math.PI * 2 * i) / 6;
            particlesRef.current.push({
              id: particleIdRef.current++,
              x: node.x,
              y: node.y,
              vx: Math.cos(angle) * (1 + Math.random()),
              vy: Math.sin(angle) * (1 + Math.random()),
              life: 1,
              color: OP_COLORS[op.operation] || "#fff",
              size: 2 + Math.random() * 2,
            });
          }
        }
      }
    }
    prevOpsCountRef.current = ops.length;
  }, [ops]);

  // Initialize / update simulation
  useEffect(() => {
    const { width, height } = dimensions;

    // Preserve positions for existing nodes
    const oldPositions = new Map<string, { x: number; y: number }>();
    for (const n of nodesRef.current) {
      if (n.x != null && n.y != null) oldPositions.set(n.id, { x: n.x, y: n.y });
    }

    // Apply old positions to new nodes
    for (const n of nodes) {
      const old = oldPositions.get(n.id);
      if (old) {
        n.x = old.x;
        n.y = old.y;
      }
    }

    nodesRef.current = nodes;
    linksRef.current = links;

    if (simRef.current) simRef.current.stop();

    simRef.current = forceSimulation<GraphNode>(nodes)
      .force("link", forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(40).strength(0.8))
      .force("charge", forceManyBody().strength(-80))
      .force("center", forceCenter(width / 2, height / 2).strength(0.05))
      .force("collision", forceCollide<GraphNode>().radius((d) => d.size + 4))
      .force("x", forceX(width / 2).strength(0.02))
      .force("y", forceY(height / 2).strength(0.02))
      .alphaDecay(0.02)
      .velocityDecay(0.4);

    return () => {
      simRef.current?.stop();
    };
  }, [nodes, links, dimensions]);

  // Mouse interaction
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let closest: GraphNode | null = null;
      let minDist = 20;
      for (const n of nodesRef.current) {
        if (n.x == null || n.y == null) continue;
        const d = Math.hypot(n.x - mx, n.y - my);
        if (d < minDist) {
          minDist = d;
          closest = n;
        }
      }
      setHoveredNode(closest);
    },
    [],
  );

  // Animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let running = true;

    function draw() {
      if (!running || !ctx || !canvas) return;

      const { width, height } = dimensions;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      // Clear
      ctx.fillStyle = "#09090b";
      ctx.fillRect(0, 0, width, height);

      const now = Date.now();
      const nodes = nodesRef.current;
      const links = linksRef.current;

      // Draw links
      ctx.strokeStyle = "rgba(63, 63, 70, 0.4)";
      ctx.lineWidth = 0.5;
      for (const link of links) {
        const s = typeof link.source === "object" ? link.source : nodes.find((n) => n.id === link.source);
        const t = typeof link.target === "object" ? link.target : nodes.find((n) => n.id === link.target);
        if (!s?.x || !s?.y || !t?.x || !t?.y) continue;

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.lineTo(t.x, t.y);
        ctx.stroke();
      }

      // Draw particles
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.life -= 0.02;

        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        ctx.globalAlpha = p.life * 0.8;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Draw nodes
      for (const node of nodes) {
        if (node.x == null || node.y == null) continue;

        const age = now - node.lastOpTime;
        const isHot = age < 5000;
        const pulse = age < 2000 ? Math.sin(age / 200) * 0.3 + 0.7 : 1;
        const isHovered = hoveredNode?.id === node.id;

        // Glow for hot nodes
        if (isHot && node.lastOp && !node.isDir) {
          const glow = OP_GLOW[node.lastOp];
          const glowSize = node.size + 8 + (isHot ? 4 * pulse : 0);
          ctx.beginPath();
          ctx.arc(node.x, node.y, glowSize, 0, Math.PI * 2);
          ctx.fillStyle = glow;
          ctx.fill();
        }

        // Node body
        const r = node.size + (isHovered ? 3 : 0);

        if (node.isDir) {
          // Directory: rounded square
          ctx.fillStyle = node.id === "." ? "#34d39933" : "#3f3f4666";
          ctx.strokeStyle = node.id === "." ? "#34d399" : "#52525b";
          ctx.lineWidth = 1;
          const s = r * 1.4;
          ctx.beginPath();
          ctx.roundRect(node.x - s / 2, node.y - s / 2, s, s, 3);
          ctx.fill();
          ctx.stroke();
        } else {
          // File: circle
          const color = isHot && node.lastOp ? OP_COLORS[node.lastOp] : extColor(node.name);
          ctx.fillStyle = node.deleted ? "#f8717133" : color;
          ctx.globalAlpha = node.deleted ? 0.3 : 1;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;

          // Ring for multi-touched files
          if (node.opCount > 1) {
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(node.x, node.y, r + 3, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        // Label
        const label = node.name;
        ctx.font = `${node.isDir ? "bold " : ""}${node.isDir ? 10 : 9}px monospace`;
        ctx.textAlign = "center";
        ctx.fillStyle = isHovered ? "#e4e4e7" : (isHot && node.lastOp ? OP_COLORS[node.lastOp] : "#71717a");
        ctx.fillText(label, node.x, node.y + r + 12);

        // Op indicator for hot files
        if (isHot && node.lastOp && !node.isDir) {
          const indicator = node.lastOp === "create" ? "+" : node.lastOp === "modify" ? "~" : "×";
          ctx.font = "bold 10px monospace";
          ctx.fillStyle = OP_COLORS[node.lastOp];
          ctx.fillText(indicator, node.x + r + 4, node.y - 2);
        }
      }

      // Hover tooltip
      if (hoveredNode && hoveredNode.x != null && hoveredNode.y != null) {
        const h = hoveredNode;
        const text = `${h.name}${h.isDir ? "/" : ""} — ${h.opCount} ops${h.lastOp ? " (last: " + h.lastOp + ")" : ""}`;
        ctx.font = "10px monospace";
        const tm = ctx.measureText(text);
        const px = Math.min(h.x, width - tm.width - 16);
        const py = h.y - h.size - 20;
        ctx.fillStyle = "#18181b";
        ctx.strokeStyle = "#3f3f46";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(px - 6, py - 10, tm.width + 12, 18, 4);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#e4e4e7";
        ctx.fillText(text, px, py + 2);
      }

      frameRef.current = requestAnimationFrame(draw);
    }

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [dimensions, hoveredNode]);

  // Stats
  const created = ops.filter((o) => o.success && o.operation === "create").length;
  const modified = ops.filter((o) => o.success && o.operation === "modify").length;
  const reads = ops.filter((o) => o.success && o.operation === "read").length;
  const fileCount = nodes.filter((n) => !n.isDir).length;

  return (
    <div ref={containerRef} className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-zinc-300">File Graph</span>
          <span className="text-[10px] text-zinc-600">{fileCount} files</span>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-emerald-400">+{created}</span>
          <span className="text-amber-400">~{modified}</span>
          <span className="text-cyan-400/60">○{reads}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="px-3 py-1 border-b border-zinc-800/50 flex gap-3 text-[9px] flex-shrink-0">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> created</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> modified</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> deleted</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-sm bg-zinc-600 inline-block" /> directory</span>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0">
        {nodes.length <= 1 ? (
          <div className="flex items-center justify-center h-full text-zinc-700 text-xs">
            <div className="text-center">
              <div className="text-2xl mb-2 animate-pulse">🌱</div>
              <div>Waiting for file operations...</div>
            </div>
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setHoveredNode(null)}
            className="w-full h-full cursor-crosshair"
            style={{ width: dimensions.width, height: dimensions.height - 60 }}
          />
        )}
      </div>
    </div>
  );
}
