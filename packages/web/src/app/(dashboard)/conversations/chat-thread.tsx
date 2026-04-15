'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, Bot, Copy, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Button } from '@/components/ui/button';
import type { ChatMessage } from './use-chat';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function handleCopy(content: string) {
  void navigator.clipboard.writeText(content);
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - msgDate.getTime()) / 86_400_000);

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-2">
      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function UserMessage({ content, createdAt }: { content: string; createdAt: string }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="max-w-[80%] rounded-3xl bg-muted px-6 py-4">
        <p className="text-sm whitespace-pre-wrap">{content}</p>
      </div>
      <span className="pr-2 text-[10px] text-muted-foreground">{formatTime(createdAt)}</span>
    </div>
  );
}

/** Dedent code blocks in raw markdown — strips common leading whitespace
 *  from the content inside fenced code blocks (``` ... ```). */
function dedentCodeBlocks(md: string): string {
  return md.replace(
    /(```\w*\n)([\s\S]*?)(```)/g,
    (_match, open: string, body: string, close: string) => {
      const lines = body.split('\n');
      const nonEmpty = lines.filter((l) => l.trim().length > 0);
      if (nonEmpty.length === 0) return `${open}${body}${close}`;
      const minIndent = Math.min(
        ...nonEmpty.map((l) => l.match(/^(\s*)/)?.[1]?.length ?? 0),
      );
      if (minIndent === 0) return `${open}${body}${close}`;
      const dedented = lines.map((l) => l.slice(minIndent)).join('\n');
      return `${open}${dedented}${close}`;
    },
  );
}

function AgentMessage({ content, createdAt }: { content: string; createdAt: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-start gap-4">
        <div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-foreground/20 bg-muted">
          <Bot className="size-3.5" />
        </div>
        <div className="flex-1 text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-headings:my-3 prose-headings:font-semibold prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 prose-pre:my-2 prose-pre:bg-gray-100 prose-pre:dark:bg-muted prose-pre:rounded-lg prose-pre:p-4 prose-pre:overflow-x-auto prose-pre:text-xs prose-pre:whitespace-pre-wrap prose-pre:break-words prose-pre:text-gray-800 prose-pre:dark:text-gray-200 prose-code:bg-gray-100 prose-code:dark:bg-muted prose-code:text-gray-800 prose-code:dark:text-gray-200 prose-code:rounded prose-code:px-1.5 prose-code:py-0.5 prose-code:text-xs prose-code:font-mono prose-code:before:content-none prose-code:after:content-none [&_pre_code]:p-0 [&_pre_code]:bg-transparent prose-a:text-primary prose-a:underline prose-a:underline-offset-2 prose-blockquote:border-l-primary prose-blockquote:not-italic prose-hr:border-border prose-strong:font-semibold prose-table:text-xs prose-th:border prose-th:border-border prose-th:bg-muted/50 prose-th:px-3 prose-th:py-1.5 prose-th:text-left prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-1.5 prose-img:rounded-md">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
            {dedentCodeBlocks(content)}
          </ReactMarkdown>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-10">
        <span className="text-[10px] text-muted-foreground">{formatTime(createdAt)}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={() => {
            handleCopy(content);
          }}
        >
          <Copy className="size-3.5 text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-4">
      <div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-foreground/20 bg-muted">
        <Bot className="size-3.5 animate-pulse" />
      </div>
      <p className="text-sm text-muted-foreground animate-pulse">
        Thinking...
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface ChatThreadProps {
  messages: ChatMessage[];
  isTyping: boolean;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export function ChatThread({
  messages,
  isTyping,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
}: ChatThreadProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevHeightRef = useRef(0);
  const hasInitialScrolled = useRef(false);
  const [showScrollDown, setShowScrollDown] = useState(false);

  // Preserve scroll position after loading older messages
  useEffect(() => {
    if (!loadingMore && scrollContainerRef.current && prevHeightRef.current > 0) {
      const newHeight = scrollContainerRef.current.scrollHeight;
      scrollContainerRef.current.scrollTop = newHeight - prevHeightRef.current;
      prevHeightRef.current = 0;
    }
  }, [loadingMore, messages.length]);

  // Auto-scroll to bottom only on first load — wait for DOM to stabilize
  useEffect(() => {
    if (hasInitialScrolled.current || loading || messages.length === 0) return;
    hasInitialScrolled.current = true;

    const container = scrollContainerRef.current;
    if (!container) return;

    let lastHeight = 0;
    let stableCount = 0;
    const poll = setInterval(() => {
      const h = container.scrollHeight;
      if (h === lastHeight && h > 0) {
        stableCount++;
        if (stableCount >= 3) {
          clearInterval(poll);
          container.scrollTop = container.scrollHeight;
        }
      } else {
        stableCount = 0;
      }
      lastHeight = h;
    }, 200);

    return () => { clearInterval(poll); };
  }, [loading, messages.length]);

  // Auto-scroll to bottom when new messages arrive.
  // Always scroll for user messages (they just sent it). For agent messages,
  // only scroll if user is near the bottom (within 600px).
  const prevMessageCountRef = useRef(messages.length);
  useEffect(() => {
    if (messages.length <= prevMessageCountRef.current) {
      prevMessageCountRef.current = messages.length;
      return;
    }

    const newMessages = messages.slice(prevMessageCountRef.current);
    const isUserMessage = newMessages.some((m) => m.role === 'user');
    prevMessageCountRef.current = messages.length;

    const el = scrollContainerRef.current;
    if (!el) return;

    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (isUserMessage || distFromBottom < 600) {
      // Delay to let the DOM fully render the new message before scrolling
      setTimeout(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }, 500);
    }
  }, [messages.length]);

  // Track scroll position for floating button + load more
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      setShowScrollDown(distFromBottom > 200);

      if (hasMore && !loadingMore && el.scrollTop < 100) {
        prevHeightRef.current = el.scrollHeight;
        onLoadMore();
      }
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); };
  }, [hasMore, loadingMore, onLoadMore]);

  const scrollToBottom = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: scrollContainerRef.current.scrollHeight, behavior: 'smooth' });
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Group messages by date for date separators
  let lastDateLabel = '';

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="h-full overflow-auto px-6 py-6"
      >
      <div className="mx-auto flex max-w-[768px] flex-col gap-6">
        {/* Load more indicator */}
        {loadingMore && (
          <div className="flex justify-center py-2">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {hasMore && !loadingMore && (
          <div className="flex justify-center">
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                if (scrollContainerRef.current) {
                  prevHeightRef.current = scrollContainerRef.current.scrollHeight;
                }
                onLoadMore();
              }}
            >
              Load older messages
            </button>
          </div>
        )}

        {messages.map((msg) => {
          // Hide system messages, tool results, and empty assistant messages (tool call requests)
          if (msg.role === 'system' || msg.role === 'tool') return null;
          if (msg.role === 'assistant' && !msg.content.trim()) return null;
          // Hide sub-agent result injections (system-generated, stored as user role)
          if (msg.role === 'user' && msg.content.startsWith('[Sub-Agent Result]')) return null;
          // Hide runtime context injections (system-generated, stored as user role)
          if (msg.role === 'user' && msg.content.startsWith('[Runtime Context]')) return null;

          // Date separator
          const dateLabel = formatDateLabel(msg.createdAt);
          const showDate = dateLabel !== lastDateLabel;
          lastDateLabel = dateLabel;

          return (
            <div key={msg.id}>
              {showDate && <DateSeparator label={dateLabel} />}
              {msg.role === 'user' ? (
                <UserMessage content={msg.content} createdAt={msg.createdAt} />
              ) : (
                <AgentMessage content={msg.content} createdAt={msg.createdAt} />
              )}
            </div>
          );
        })}

        {isTyping && <TypingIndicator />}

        <div ref={messagesEndRef} />
      </div>
      </div>

      {/* Floating scroll-to-bottom button */}
      {showScrollDown && (
        <Button
          variant="secondary"
          size="icon"
          className="absolute bottom-4 right-6 z-10 size-9 cursor-pointer rounded-full shadow-lg"
          onClick={scrollToBottom}
        >
          <ArrowDown className="size-4" />
        </Button>
      )}
    </div>
  );
}
