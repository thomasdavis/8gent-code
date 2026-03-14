/**
 * Virtual scroll for chat messages.
 *
 * Tracks a scroll offset into a flat list of messages. Only the visible
 * window is rendered — everything else is clipped. Auto-scrolls to the
 * bottom on new messages unless the user has scrolled up.
 *
 * This is the "array slicing" approach (not marginTop) because we want
 * per-message granularity and our messages are roughly 1-3 lines each.
 */

import { useState, useEffect, useCallback, useRef } from "react";

export interface ChatScrollState {
  /** Index of the first visible message */
  scrollOffset: number;
  /** Whether auto-scroll is active (pinned to bottom) */
  autoScroll: boolean;
  /** The visible slice of items */
  visibleRange: { start: number; end: number };
  /** Number of messages above the viewport */
  hiddenAbove: number;
  /** Number of messages below the viewport */
  hiddenBelow: number;

  // Actions
  scrollUp: (lines?: number) => void;
  scrollDown: (lines?: number) => void;
  scrollToTop: () => void;
  scrollToBottom: () => void;
  pageUp: () => void;
  pageDown: () => void;
}

export function useChatScroll(
  totalItems: number,
  viewportHeight: number,
): ChatScrollState {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [autoScroll, setAutoScroll] = useState(true);
  const prevTotalRef = useRef(totalItems);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (totalItems > prevTotalRef.current && autoScroll) {
      const maxOffset = Math.max(0, totalItems - viewportHeight);
      setScrollOffset(maxOffset);
    }
    prevTotalRef.current = totalItems;
  }, [totalItems, autoScroll, viewportHeight]);

  // Clamp offset when viewport resizes
  useEffect(() => {
    setScrollOffset((prev) => {
      const maxOffset = Math.max(0, totalItems - viewportHeight);
      if (prev > maxOffset) return maxOffset;
      return prev;
    });
  }, [viewportHeight, totalItems]);

  const maxOffset = Math.max(0, totalItems - viewportHeight);

  const scrollUp = useCallback((lines = 1) => {
    setAutoScroll(false);
    setScrollOffset((prev) => Math.max(0, prev - lines));
  }, []);

  const scrollDown = useCallback((lines = 1) => {
    setScrollOffset((prev) => {
      const next = Math.min(maxOffset, prev + lines);
      if (next >= maxOffset) setAutoScroll(true);
      return next;
    });
  }, [maxOffset]);

  const scrollToTop = useCallback(() => {
    setAutoScroll(false);
    setScrollOffset(0);
  }, []);

  const scrollToBottom = useCallback(() => {
    setAutoScroll(true);
    setScrollOffset(maxOffset);
  }, [maxOffset]);

  const pageUp = useCallback(() => {
    setAutoScroll(false);
    setScrollOffset((prev) => Math.max(0, prev - viewportHeight));
  }, [viewportHeight]);

  const pageDown = useCallback(() => {
    setScrollOffset((prev) => {
      const next = Math.min(maxOffset, prev + viewportHeight);
      if (next >= maxOffset) setAutoScroll(true);
      return next;
    });
  }, [maxOffset, viewportHeight]);

  const end = Math.min(totalItems, scrollOffset + viewportHeight);

  return {
    scrollOffset,
    autoScroll,
    visibleRange: { start: scrollOffset, end },
    hiddenAbove: scrollOffset,
    hiddenBelow: Math.max(0, totalItems - end),
    scrollUp,
    scrollDown,
    scrollToTop,
    scrollToBottom,
    pageUp,
    pageDown,
  };
}
