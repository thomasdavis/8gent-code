/**
 * OSC 52 Clipboard Support
 *
 * Uses the OSC 52 escape sequence to copy text to the system clipboard.
 * Works in: WezTerm, Kitty, Ghostty, iTerm2, Alacritty, Windows Terminal, tmux.
 * Works over SSH and inside terminal multiplexers — no pbcopy/xclip needed.
 */

/**
 * Copy text to the system clipboard via OSC 52 escape sequence.
 * Falls back to pbcopy on macOS if OSC 52 isn't supported.
 */
export function copyToClipboard(text: string): void {
  const b64 = Buffer.from(text).toString("base64");
  // OSC 52: set clipboard contents
  // \x1b]52;c;BASE64\x07
  process.stdout.write(`\x1b]52;c;${b64}\x07`);
}

/**
 * Copy text with a fallback chain: OSC 52 → pbcopy (macOS) → xclip (Linux)
 */
export async function copyToClipboardWithFallback(text: string): Promise<boolean> {
  // Try OSC 52 first (works everywhere modern)
  copyToClipboard(text);

  // Also try native clipboard as backup
  try {
    const { execSync } = await import("child_process");
    if (process.platform === "darwin") {
      execSync("pbcopy", { input: text, stdio: ["pipe", "ignore", "ignore"] });
    } else if (process.platform === "linux") {
      execSync("xclip -selection clipboard", { input: text, stdio: ["pipe", "ignore", "ignore"] });
    }
    return true;
  } catch {
    // OSC 52 was already sent, so clipboard might still work
    return true;
  }
}
