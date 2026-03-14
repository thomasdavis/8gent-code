/**
 * BufferedInput — A keystroke-safe text input for Ink.
 *
 * ink-text-input drops characters during React re-renders because each
 * render cycle can miss input events. This component decouples keystroke
 * capture from rendering by using a ref-based buffer that flushes to
 * React state on a microtask, batching rapid keystrokes into a single
 * state update.
 *
 * Supports: typing, backspace, cursor movement (left/right), home/end,
 * Ctrl+W (delete word), Ctrl+U (clear line), submit (Enter), paste.
 */

import React, { useState, useRef, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { AppText, MutedText } from "./primitives/index.js";

interface BufferedInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  isActive?: boolean;
}

export function BufferedInput({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  isActive = true,
}: BufferedInputProps) {
  const [cursor, setCursor] = useState(value.length);
  const bufferRef = useRef(value);
  const cursorRef = useRef(cursor);
  const flushScheduled = useRef(false);

  // Keep refs in sync with props
  useEffect(() => {
    bufferRef.current = value;
    cursorRef.current = Math.min(cursor, value.length);
    setCursor(cursorRef.current);
  }, [value]);

  // Flush buffer to React state — batches multiple keystrokes
  const flush = useCallback(() => {
    if (!flushScheduled.current) {
      flushScheduled.current = true;
      // Use queueMicrotask to batch rapid keystrokes into one state update
      queueMicrotask(() => {
        flushScheduled.current = false;
        onChange(bufferRef.current);
        setCursor(cursorRef.current);
      });
    }
  }, [onChange]);

  useInput(
    (input, key) => {
      const buf = bufferRef.current;
      const cur = cursorRef.current;

      // Submit — let the parent handle clearing via onChange
      if (key.return) {
        if (buf.trim()) {
          onSubmit(buf);
        }
        return;
      }

      // Backspace
      if (key.backspace || key.delete) {
        if (cur > 0) {
          bufferRef.current = buf.slice(0, cur - 1) + buf.slice(cur);
          cursorRef.current = cur - 1;
          flush();
        }
        return;
      }

      // Arrow keys
      if (key.leftArrow) {
        if (cur > 0) {
          cursorRef.current = cur - 1;
          flush();
        }
        return;
      }
      if (key.rightArrow) {
        if (cur < buf.length) {
          cursorRef.current = cur + 1;
          flush();
        }
        return;
      }

      // Ctrl shortcuts
      if (key.ctrl) {
        if (input === "a") {
          // Home
          cursorRef.current = 0;
          flush();
          return;
        }
        if (input === "e") {
          // End
          cursorRef.current = buf.length;
          flush();
          return;
        }
        if (input === "w") {
          // Delete word backward
          const before = buf.slice(0, cur);
          const trimmed = before.replace(/\S+\s*$/, "");
          bufferRef.current = trimmed + buf.slice(cur);
          cursorRef.current = trimmed.length;
          flush();
          return;
        }
        if (input === "u") {
          // Clear to start of line
          bufferRef.current = buf.slice(cur);
          cursorRef.current = 0;
          flush();
          return;
        }
        // Don't consume other ctrl combos — let them bubble to app hotkeys
        return;
      }

      // Regular character input
      if (input && !key.ctrl && !key.meta) {
        bufferRef.current = buf.slice(0, cur) + input + buf.slice(cur);
        cursorRef.current = cur + input.length;
        flush();
      }
    },
    { isActive },
  );

  // Render
  const showPlaceholder = value.length === 0 && placeholder;
  const beforeCursor = value.slice(0, cursor);
  const atCursor = value[cursor] || " ";
  const afterCursor = value.slice(cursor + 1);

  return (
    <Box>
      {showPlaceholder ? (
        <MutedText>{placeholder}</MutedText>
      ) : (
        <>
          <AppText>{beforeCursor}</AppText>
          <Text inverse>{atCursor}</Text>
          <AppText>{afterCursor}</AppText>
        </>
      )}
    </Box>
  );
}
