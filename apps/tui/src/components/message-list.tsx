/**
 * 8gent Code - Message List with Virtual Scrolling
 *
 * Only renders the visible window of messages. Supports:
 * - Auto-scroll to bottom on new messages
 * - Scroll lock when user scrolls up
 * - Scroll indicators ("↑ N more" / "↓ N more")
 * - React.memo on message items to prevent re-renders during streaming
 */

import React, { useState, useEffect, useRef, memo } from "react";
import { Box, Text } from "ink";
import type { Message } from "../app.js";
import { TypingText, WordByWord } from "./typing-text.js";
import { FadeIn, PopIn } from "./fade-transition.js";
import { useCompletionSound } from "./sound-effects.js";
import { useADHDMode, BionicText } from "./bionic-text.js";
import { AppText, MutedText, Label, Stack } from "./primitives/index.js";
import { useChatScroll } from "../hooks/useChatScroll.js";

interface MessageListProps {
  messages: Message[];
  animateTyping?: boolean;
  soundEnabled?: boolean;
  /** Available height in rows for the message viewport */
  viewportHeight?: number;
}

export function MessageList({
  messages,
  animateTyping = true,
  soundEnabled = false,
  viewportHeight = 20,
}: MessageListProps) {
  const scroll = useChatScroll(messages.length, viewportHeight);
  const prevCountRef = useRef(messages.length);
  const [newMessageId, setNewMessageId] = useState<string | null>(null);

  // Track new messages for animation
  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      const newMessage = messages[messages.length - 1];
      setNewMessageId(newMessage.id);
    }
    prevCountRef.current = messages.length;
  }, [messages]);

  // Slice the visible window
  const visibleMessages = messages.slice(
    scroll.visibleRange.start,
    scroll.visibleRange.end,
  );

  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {/* Scroll-up indicator */}
      {scroll.hiddenAbove > 0 && (
        <Box paddingX={1}>
          <MutedText>↑ {scroll.hiddenAbove} more above</MutedText>
        </Box>
      )}

      {/* Visible messages */}
      {visibleMessages.map((message, i) => (
        <MemoizedMessageItem
          key={message.id}
          message={message}
          isNew={message.id === newMessageId}
          animate={animateTyping}
          soundEnabled={soundEnabled}
          index={scroll.visibleRange.start + i}
        />
      ))}

      {/* Scroll-down indicator */}
      {scroll.hiddenBelow > 0 && (
        <Box paddingX={1}>
          <MutedText>↓ {scroll.hiddenBelow} more below</MutedText>
        </Box>
      )}
    </Box>
  );
}

// Export scroll actions so app.tsx can wire keyboard shortcuts
export { useChatScroll } from "../hooks/useChatScroll.js";

// ============================================
// Message Item (memoized to prevent re-renders)
// ============================================

interface MessageItemProps {
  message: Message;
  isNew: boolean;
  animate: boolean;
  soundEnabled: boolean;
  index: number;
}

const MemoizedMessageItem = memo(function MessageItem({
  message,
  isNew,
  animate,
  soundEnabled,
  index,
}: MessageItemProps) {
  const [showContent, setShowContent] = useState(!isNew);
  const [typingComplete, setTypingComplete] = useState(!isNew || !animate);

  useCompletionSound(
    typingComplete && message.role === "assistant" && isNew,
    soundEnabled,
  );

  useEffect(() => {
    if (isNew) {
      const timeout = setTimeout(() => setShowContent(true), 50);
      return () => clearTimeout(timeout);
    }
  }, [isNew]);

  // Tool messages: compact inline
  if (message.role === "tool") {
    return (
      <Box paddingLeft={2}>
        <MutedText>{message.content}</MutedText>
      </Box>
    );
  }

  const roleConfig = {
    user: { color: "yellow" as const, label: "You", icon: "▸" },
    assistant: { color: "cyan" as const, label: "8gent", icon: "◆" },
    system: { color: "cyan" as const, label: "System", icon: "●" },
  };

  const config = roleConfig[message.role as "user" | "assistant" | "system"];

  if (!showContent) {
    return (
      <Box marginBottom={1}>
        <MutedText>...</MutedText>
      </Box>
    );
  }

  return (
    <FadeIn duration={200} delay={isNew ? Math.min(index * 20, 200) : 0}>
      <Stack marginBottom={1}>
        <Box>
          <PopIn delay={isNew ? 50 : 0}>
            <Text color={config.color}>{config.icon} </Text>
          </PopIn>
          <Label color={config.color}>{config.label}</Label>
          <MutedText> {formatTime(message.timestamp)}</MutedText>
        </Box>
        <Box paddingLeft={2}>
          <MessageContent
            content={message.content}
            role={message.role}
            isNew={isNew}
            animate={animate}
            onTypingComplete={() => setTypingComplete(true)}
          />
        </Box>
      </Stack>
    </FadeIn>
  );
}, (prev, next) => {
  // Only re-render if the message itself changed or isNew changed
  return prev.message.id === next.message.id
    && prev.message.content === next.message.content
    && prev.isNew === next.isNew;
});

// ============================================
// Message Content
// ============================================

interface MessageContentProps {
  content: string;
  role: "user" | "assistant" | "system" | "tool";
  isNew: boolean;
  animate: boolean;
  onTypingComplete: () => void;
}

function MessageContent({
  content,
  role,
  isNew,
  animate,
  onTypingComplete,
}: MessageContentProps) {
  const { enabled: adhdMode } = useADHDMode();
  const shouldAnimate = isNew && animate && role === "assistant";

  if (shouldAnimate) {
    if (content.length > 200) {
      return <WordByWord text={content} speed={30} onComplete={onTypingComplete} />;
    }
    return <TypingText text={content} speed={12} onComplete={onTypingComplete} cursor={true} />;
  }

  if (content.includes("```")) {
    return <FormattedContent content={content} adhdMode={adhdMode} />;
  }

  if (adhdMode) {
    return <BionicText>{content}</BionicText>;
  }

  return <AppText wrap="wrap">{content}</AppText>;
}

// ============================================
// Code Block Formatting
// ============================================

function FormattedContent({ content, adhdMode = false }: { content: string; adhdMode?: boolean }) {
  const parts = content.split(/(```[\s\S]*?```)/);

  return (
    <Box flexDirection="column">
      {parts.map((part, index) => {
        if (part.startsWith("```")) {
          const match = part.match(/```(\w+)?\n?([\s\S]*?)```/);
          if (match) {
            const [, language, code] = match;
            return (
              <Box
                key={index}
                flexDirection="column"
                borderStyle="round"
                borderColor="blue"
                paddingX={1}
                marginY={1}
              >
                {language && <MutedText>{language}</MutedText>}
                <Text color="green">{code.trim()}</Text>
              </Box>
            );
          }
        }
        if (adhdMode) {
          return <BionicText key={index}>{part}</BionicText>;
        }
        return <AppText key={index} wrap="wrap">{part}</AppText>;
      })}
    </Box>
  );
}

// ============================================
// Helpers
// ============================================

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Compact message item for dense view
export function CompactMessageItem({ message }: { message: Message }) {
  if (message.role === "tool") {
    return (
      <Box paddingLeft={2}>
        <MutedText>{message.content}</MutedText>
      </Box>
    );
  }

  const roleIcons: Record<string, string> = { user: "→", assistant: "←", system: "•", tool: " " };
  const roleColors: Record<string, "yellow" | "cyan" | "green" | "magenta"> = {
    user: "yellow", assistant: "cyan", system: "cyan", tool: "magenta",
  };

  return (
    <Box>
      <Text color={roleColors[message.role]}>{roleIcons[message.role]} </Text>
      <AppText wrap="wrap">{message.content}</AppText>
    </Box>
  );
}

// Streaming message for real-time responses
export function StreamingMessage({ chunks, isComplete }: { chunks: string[]; isComplete: boolean }) {
  const [displayedChunks, setDisplayedChunks] = useState(0);

  useEffect(() => {
    if (displayedChunks < chunks.length) {
      const timeout = setTimeout(() => setDisplayedChunks((prev) => prev + 1), 30);
      return () => clearTimeout(timeout);
    }
  }, [chunks.length, displayedChunks]);

  return (
    <Stack marginBottom={1}>
      <Box>
        <Label color="cyan">◆ 8gent</Label>
        {!isComplete && <Text color="cyan"> ▌</Text>}
      </Box>
      <Box paddingLeft={2}>
        <AppText wrap="wrap">{chunks.slice(0, displayedChunks).join("")}</AppText>
      </Box>
    </Stack>
  );
}
