"use client";

import { useMemo, useState, useEffect, useRef } from "react";

/**
 * Real-time file tree graph that visualizes file operations as they stream in.
 *
 * Each file operation (create, modify, delete, read) animates into the tree.
 * Files pulse when touched, fade when idle. The tree builds itself as the
 * session progresses.
 */

// ============================================
// Types
// ============================================

interface FileEvent {
  path: string;
  operation: "create" | "modify" | "delete" | "read";
  timestamp: string;
  success: boolean;
  stepNumber?: number;
}

interface FileNode {
  name: string;
  path: string;
  isDir: boolean;
  children: Map<string, FileNode>;
  lastOp: "create" | "modify" | "delete" | "read" | null;
  lastOpTime: number;
  opCount: number;
  deleted: boolean;
}

interface FileTreeGraphProps {
  entries: Array<{
    type: string;
    toolCall?: {
      name?: string;
      arguments?: Record<string, unknown>;
    };
    toolName?: string;
    success?: boolean;
    timestamp?: string;
    stepNumber?: number;
    toolCallId?: string;
    summary?: {
      filesCreated?: string[];
      filesModified?: string[];
      filesDeleted?: string[];
    };
  }>;
  workingDirectory?: string;
}

// ============================================
// Extract file events from session entries
// ============================================

function extractFileEvents(entries: FileTreeGraphProps["entries"]): FileEvent[] {
  const events: FileEvent[] = [];
  const toolResults = new Map<string, boolean>();

  // First pass: collect tool results
  for (const entry of entries) {
    if (entry.type === "tool_result" && entry.toolCallId != null) {
      toolResults.set(entry.toolCallId, entry.success ?? false);
    }
  }

  // Second pass: extract file operations from tool calls
  for (const entry of entries) {
    if (entry.type !== "tool_call" || !entry.toolCall) continue;

    const name = entry.toolCall.name;
    const args = entry.toolCall.arguments || {};
    const path = args.path as string | undefined;
    if (!path) continue;

    let operation: FileEvent["operation"] | null = null;
    switch (name) {
      case "write_file": operation = "create"; break;
      case "edit_file": operation = "modify"; break;
      case "delete_file": operation = "delete"; break;
      case "read_file": operation = "read"; break;
    }

    if (operation) {
      const toolCallId = (entry as any).toolCall?.toolCallId;
      const success = toolCallId ? (toolResults.get(toolCallId) ?? true) : true;

      events.push({
        path,
        operation,
        timestamp: entry.timestamp || "",
        success,
        stepNumber: entry.stepNumber,
      });
    }
  }

  return events;
}

// ============================================
// Build tree from events
// ============================================

function buildFileTree(events: FileEvent[], workDir: string): FileNode {
  const root: FileNode = {
    name: "/",
    path: "",
    isDir: true,
    children: new Map(),
    lastOp: null,
    lastOpTime: 0,
    opCount: 0,
    deleted: false,
  };

  for (const event of events) {
    if (!event.success) continue;

    // Normalize path relative to working directory
    let relPath = event.path;
    if (relPath.startsWith(workDir)) {
      relPath = relPath.slice(workDir.length);
    }
    if (relPath.startsWith("/")) relPath = relPath.slice(1);
    if (!relPath) continue;

    const parts = relPath.split("/");
    let current = root;

    // Build directory path
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          path: parts.slice(0, i + 1).join("/"),
          isDir: true,
          children: new Map(),
          lastOp: null,
          lastOpTime: 0,
          opCount: 0,
          deleted: false,
        });
      }
      current = current.children.get(part)!;
    }

    // Add or update file
    const fileName = parts[parts.length - 1];
    if (!current.children.has(fileName)) {
      current.children.set(fileName, {
        name: fileName,
        path: relPath,
        isDir: false,
        children: new Map(),
        lastOp: event.operation,
        lastOpTime: Date.now(),
        opCount: 1,
        deleted: event.operation === "delete",
      });
    } else {
      const node = current.children.get(fileName)!;
      // write_file after initial create is a modify
      if (event.operation === "create" && node.opCount > 0) {
        node.lastOp = "modify";
      } else {
        node.lastOp = event.operation;
      }
      node.lastOpTime = Date.now();
      node.opCount++;
      node.deleted = event.operation === "delete";
    }
  }

  return root;
}

// ============================================
// Flatten tree for rendering
// ============================================

interface FlatNode {
  name: string;
  path: string;
  depth: number;
  isDir: boolean;
  isLast: boolean;
  lastOp: FileEvent["operation"] | null;
  lastOpTime: number;
  opCount: number;
  deleted: boolean;
  hasChildren: boolean;
}

function flattenTree(node: FileNode, depth = 0, parentIsLast = true): FlatNode[] {
  const result: FlatNode[] = [];
  const children = Array.from(node.children.values()).sort((a, b) => {
    // Directories first, then alphabetical
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  children.forEach((child, i) => {
    const isLast = i === children.length - 1;
    result.push({
      name: child.name,
      path: child.path,
      depth,
      isDir: child.isDir,
      isLast,
      lastOp: child.lastOp,
      lastOpTime: child.lastOpTime,
      opCount: child.opCount,
      deleted: child.deleted,
      hasChildren: child.children.size > 0,
    });

    if (child.isDir && child.children.size > 0) {
      result.push(...flattenTree(child, depth + 1, isLast));
    }
  });

  return result;
}

// ============================================
// Color and icon helpers
// ============================================

function opColor(op: FileEvent["operation"] | null): string {
  switch (op) {
    case "create": return "text-emerald-400";
    case "modify": return "text-amber-400";
    case "delete": return "text-red-400";
    case "read": return "text-cyan-400";
    default: return "text-zinc-500";
  }
}

function opBgPulse(op: FileEvent["operation"] | null): string {
  switch (op) {
    case "create": return "bg-emerald-500/10";
    case "modify": return "bg-amber-500/10";
    case "delete": return "bg-red-500/10";
    case "read": return "bg-cyan-500/5";
    default: return "";
  }
}

function opIcon(op: FileEvent["operation"] | null): string {
  switch (op) {
    case "create": return "+";
    case "modify": return "~";
    case "delete": return "×";
    case "read": return "○";
    default: return " ";
  }
}

function fileIcon(name: string, isDir: boolean): string {
  if (isDir) return "📁";
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts": case "tsx": return "🔷";
    case "js": case "jsx": return "🟡";
    case "json": return "📋";
    case "css": return "🎨";
    case "md": return "📝";
    case "html": return "🌐";
    case "svg": return "🖼️";
    case "test": return "🧪";
    default: return "📄";
  }
}

// ============================================
// Component
// ============================================

export default function FileTreeGraph({ entries, workingDirectory }: FileTreeGraphProps) {
  const [tick, setTick] = useState(0);
  const prevCountRef = useRef(0);

  // Tick for animation freshness (which files are "hot")
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(interval);
  }, []);

  const workDir = workingDirectory || "";

  const events = useMemo(() => extractFileEvents(entries), [entries]);
  const tree = useMemo(() => buildFileTree(events, workDir), [events, workDir]);
  const flatNodes = useMemo(() => flattenTree(tree), [tree]);

  // Count new events since last render for the activity indicator
  const totalEvents = events.filter((e) => e.success && e.operation !== "read").length;
  const isNew = totalEvents > prevCountRef.current;
  useEffect(() => {
    prevCountRef.current = totalEvents;
  }, [totalEvents]);

  if (flatNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-700 text-xs">
        <div className="text-center">
          <div className="text-2xl mb-2">🌱</div>
          <div>Waiting for file operations...</div>
        </div>
      </div>
    );
  }

  // Stats
  const created = events.filter((e) => e.success && e.operation === "create").length;
  const modified = events.filter((e) => e.success && e.operation === "modify").length;
  const reads = events.filter((e) => e.success && e.operation === "read").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-zinc-300">File Activity</span>
          {isNew && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
          )}
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="text-emerald-400">+{created}</span>
          <span className="text-amber-400">~{modified}</span>
          <span className="text-cyan-400/60">○{reads}</span>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {flatNodes.map((node) => {
          const age = Date.now() - node.lastOpTime;
          const isHot = age < 5000;
          const isFresh = age < 1000;

          return (
            <div
              key={node.path}
              className={`
                flex items-center gap-1 py-[1px] rounded-sm text-[11px] font-mono
                transition-all duration-500
                ${isFresh ? "animate-pulse" : ""}
                ${isHot ? opBgPulse(node.lastOp) : ""}
                ${node.deleted ? "opacity-30 line-through" : ""}
              `}
              style={{ paddingLeft: `${node.depth * 16 + 4}px` }}
            >
              {/* Tree connector */}
              <span className="text-zinc-700 select-none w-3">
                {node.isLast ? "└" : "├"}
              </span>

              {/* Operation indicator */}
              {node.lastOp && !node.isDir && (
                <span className={`w-3 text-center ${opColor(node.lastOp)} ${isHot ? "font-bold" : ""}`}>
                  {opIcon(node.lastOp)}
                </span>
              )}

              {/* Icon */}
              <span className="w-4 text-center text-[10px]">
                {fileIcon(node.name, node.isDir)}
              </span>

              {/* Name */}
              <span className={`
                ${node.isDir ? "text-zinc-400" : isHot ? opColor(node.lastOp) : "text-zinc-500"}
                ${node.isDir ? "font-medium" : ""}
                truncate
              `}>
                {node.name}{node.isDir ? "/" : ""}
              </span>

              {/* Operation count badge */}
              {node.opCount > 1 && !node.isDir && (
                <span className="text-[9px] text-zinc-600 ml-auto">
                  ×{node.opCount}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
