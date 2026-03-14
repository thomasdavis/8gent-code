#!/usr/bin/env bun
/**
 * 8gent Code - Terminal UI
 *
 * A structured agentic coding environment.
 * Built with Ink (React for CLI).
 */

import React from "react";
import { render } from "ink";
import { App } from "./app.js";
import { enableInfiniteMode } from "../../../packages/permissions/index.js";

// Parse CLI args
const args = process.argv.slice(2);
const command = args[0] || "repl";

// Check for --infinite flag (supports --infinite, -infinite, -i)
const hasInfiniteFlag = args.includes("--infinite") || args.includes("-infinite") || args.includes("-i");
if (hasInfiniteFlag) {
  enableInfiniteMode();
  console.log("\x1b[33m[∞] Infinite Loop mode enabled\x1b[0m\n");
}

// Filter out the flag from args passed to app
const filteredArgs = args.filter(a => a !== "--infinite" && a !== "-infinite" && a !== "-i");

// Render the TUI in fullscreen (alternate screen buffer)
// This gives us layout control: fixed header/footer, scrollable content, sidebar.
// Without it, Ink clears terminal scrollback when content overflows.
const { waitUntilExit } = render(
  <App initialCommand={command} args={filteredArgs.slice(1)} />,
  { fullscreen: true },
);

// Clean exit: ensure alternate screen is restored on all exit paths
waitUntilExit().catch(() => {});
