/**
 * BufferedInput — A keystroke-safe text input for Ink.
 *
 * UNCONTROLLED component. The internal ref-based buffer is the source of
 * truth for the current text. The parent is notified via onChange but
 * never writes back — this prevents re-renders from clobbering buffered
 * keystrokes.
 *
 * The parent can clear the input by calling the imperative reset() method
 * via the ref, or by passing a new `resetKey` prop.
 */

import React, { useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from "react";
import { Box, Text, useInput } from "ink";
import { AppText, MutedText } from "./primitives/index.js";

export interface BufferedInputHandle {
  reset: () => void;
  getValue: () => string;
  setValue: (v: string) => void;
}

interface BufferedInputProps {
  onChange?: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  isActive?: boolean;
  /** Change this value to reset the input (e.g., increment a counter after submit) */
  resetKey?: number;
}

export const BufferedInput = forwardRef<BufferedInputHandle, BufferedInputProps>(
  function BufferedInput(
    {
      onChange,
      onSubmit,
      placeholder = "",
      isActive = true,
      resetKey = 0,
    },
    ref,
  ) {
    // The buffer and cursor live in refs — never lost to re-renders
    const bufferRef = useRef("");
    const cursorRef = useRef(0);

    // Display state — updated less frequently via flush
    const [displayValue, setDisplayValue] = useState("");
    const [displayCursor, setDisplayCursor] = useState(0);
    const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Imperative handle for parent to reset/read
    useImperativeHandle(ref, () => ({
      reset: () => {
        bufferRef.current = "";
        cursorRef.current = 0;
        setDisplayValue("");
        setDisplayCursor(0);
      },
      getValue: () => bufferRef.current,
      setValue: (v: string) => {
        bufferRef.current = v;
        cursorRef.current = v.length;
        setDisplayValue(v);
        setDisplayCursor(v.length);
      },
    }));

    // Reset when resetKey changes (parent signals a clear)
    useEffect(() => {
      bufferRef.current = "";
      cursorRef.current = 0;
      setDisplayValue("");
      setDisplayCursor(0);
    }, [resetKey]);

    // Flush: sync refs → display state. Debounced to batch rapid keystrokes.
    const flush = useCallback(() => {
      if (flushTimer.current) return; // already scheduled
      flushTimer.current = setTimeout(() => {
        flushTimer.current = null;
        const val = bufferRef.current;
        const cur = cursorRef.current;
        setDisplayValue(val);
        setDisplayCursor(cur);
        onChange?.(val);
      }, 16); // ~1 frame at 60fps
    }, [onChange]);

    useInput(
      (input, key) => {
        // Read from refs — always current, never stale
        let buf = bufferRef.current;
        let cur = cursorRef.current;

        // Submit
        if (key.return) {
          if (buf.trim()) {
            const submitted = buf;
            bufferRef.current = "";
            cursorRef.current = 0;
            setDisplayValue("");
            setDisplayCursor(0);
            onSubmit(submitted);
          }
          return;
        }

        // Tab, escape, up/down arrows — don't handle, let other useInput hooks catch them
        if (key.tab || key.escape || key.upArrow || key.downArrow) {
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

        // Left/right arrows
        if (key.leftArrow) {
          if (cur > 0) { cursorRef.current = cur - 1; flush(); }
          return;
        }
        if (key.rightArrow) {
          if (cur < buf.length) { cursorRef.current = cur + 1; flush(); }
          return;
        }

        // Ctrl shortcuts
        if (key.ctrl) {
          switch (input) {
            case "a": cursorRef.current = 0; flush(); return;
            case "e": cursorRef.current = buf.length; flush(); return;
            case "w": {
              const before = buf.slice(0, cur).replace(/\S+\s*$/, "");
              bufferRef.current = before + buf.slice(cur);
              cursorRef.current = before.length;
              flush();
              return;
            }
            case "u":
              bufferRef.current = buf.slice(cur);
              cursorRef.current = 0;
              flush();
              return;
          }
          // Don't consume other ctrl combos
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

    // Render from display state (not refs — React needs state to trigger render)
    const showPlaceholder = displayValue.length === 0;
    const before = displayValue.slice(0, displayCursor);
    const at = displayValue[displayCursor] || " ";
    const after = displayValue.slice(displayCursor + 1);

    return (
      <Box>
        {showPlaceholder ? (
          <MutedText>{placeholder}</MutedText>
        ) : (
          <>
            <AppText>{before}</AppText>
            <Text inverse>{at}</Text>
            {after && <AppText>{after}</AppText>}
          </>
        )}
      </Box>
    );
  },
);
