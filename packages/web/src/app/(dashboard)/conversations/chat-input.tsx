'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Send, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/auth';

/* ------------------------------------------------------------------ */
/*  Slash commands & skills                                            */
/* ------------------------------------------------------------------ */

interface SlashItem {
  name: string;
  description: string;
  type: 'command' | 'skill';
}

const builtinCommands: SlashItem[] = [
  { name: '/reset', description: 'Start a fresh conversation (current session is archived)', type: 'command' },
  { name: '/compact', description: 'Summarize conversation context to free up space', type: 'command' },
  { name: '/help', description: 'Show available commands', type: 'command' },
];

const suggestions = [
  {
    title: 'Analyze market trends',
    description: 'for AI orchestration platforms',
  },
  {
    title: 'Review pull request',
    description: 'with security-focused analysis',
  },
  {
    title: 'Create a deployment plan',
    description: 'for Docker Compose setup',
  },
  {
    title: 'Explain container isolation',
    description: 'in multi-agent systems',
  },
];

/* ------------------------------------------------------------------ */
/*  SuggestionCard                                                     */
/* ------------------------------------------------------------------ */

function SuggestionCard({
  title,
  description,
  onClick,
}: {
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-start justify-center rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/50"
    >
      <span className="text-sm font-semibold">{title}</span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  EmptyState                                                         */
/* ------------------------------------------------------------------ */

export function EmptyState({
  onSelectSuggestion,
}: {
  onSelectSuggestion: (text: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8">
      <div className="flex size-12 items-center justify-center rounded-full border border-foreground/20 bg-muted">
        <Bot className="size-6" />
      </div>
      <div className="grid w-full max-w-[768px] grid-cols-2 gap-2">
        {suggestions.map((s) => (
          <SuggestionCard
            key={s.title}
            title={s.title}
            description={s.description}
            onClick={() => {
              onSelectSuggestion(`${s.title} ${s.description}`);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ChatInput                                                          */
/* ------------------------------------------------------------------ */

export function ChatInput({
  onSend,
  disabled,
  isConnected,
  userMessages = [],
}: {
  onSend: (content: string) => boolean | void;
  disabled: boolean;
  isConnected: boolean;
  userMessages?: string[];
}) {
  const [value, setValue] = useState('');
  const [mounted, setMounted] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [slashItems, setSlashItems] = useState<SlashItem[]>(builtinCommands);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const historyIndexRef = useRef(-1);
  const savedInputRef = useRef('');
  // User messages in reverse order (most recent first) for history navigation
  const inputHistory = userMessages;
  useEffect(() => { setMounted(true); }, []);

  // Fetch skills and merge with builtin commands
  useEffect(() => {
    void authFetch<{ data: Array<{ name: string; description: string }> }>('/api/v1/skills')
      .then((res) => {
        const skills: SlashItem[] = (Array.isArray(res.data) ? res.data : []).map((s) => ({
          name: `/${s.name}`,
          description: s.description,
          type: 'skill' as const,
        }));
        setSlashItems([...skills, ...builtinCommands]);
      })
      .catch(() => { /* keep builtin commands only */ });
  }, []);

  // Filter commands based on current input
  const filteredCommands = value.startsWith('/')
    ? slashItems.filter((cmd) =>
        cmd.name.toLowerCase().startsWith(value.toLowerCase()),
      )
    : [];

  // Show/hide command menu based on input
  useEffect(() => {
    if (value.startsWith('/') && !value.includes(' ') && filteredCommands.length > 0) {
      setShowCommands(true);
      setSelectedCommandIndex(0);
    } else {
      setShowCommands(false);
    }
  }, [value, filteredCommands.length]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  function selectCommand(command: string) {
    setValue(command);
    setShowCommands(false);
    textareaRef.current?.focus();
  }

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled || !isConnected) return;

    // Check if this is a skill invocation (not a builtin command)
    const matchedSkill = slashItems.find(
      (item) => item.type === 'skill' && trimmed.toLowerCase().startsWith(item.name.toLowerCase()),
    );
    let sent: boolean | void;
    if (matchedSkill) {
      const skillName = matchedSkill.name.slice(1); // remove leading /
      const args = trimmed.slice(matchedSkill.name.length).trim();
      const prompt = args
        ? `Use the ${skillName} skill to help me: ${args}`
        : `Use the ${skillName} skill to help me. Guide me step by step.`;
      sent = onSend(prompt);
    } else {
      sent = onSend(trimmed);
    }

    // Keep input text if send failed (e.g. disconnected)
    if (sent === false) return;

    historyIndexRef.current = -1;
    savedInputRef.current = '';

    setValue('');
    setShowCommands(false);
    // Reset textarea height after send
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }

  return (
    <div className="px-6 pb-2">
      <div className="relative mx-auto max-w-[768px]">
        {/* Slash command menu */}
        {showCommands && filteredCommands.length > 0 && (
          <div className="absolute bottom-full left-0 z-50 mb-2 w-full rounded-xl border bg-popover p-1 shadow-lg">
            {filteredCommands.map((cmd, i) => (
              <button
                key={cmd.name}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  i === selectedCommandIndex
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted',
                )}
                onMouseEnter={() => setSelectedCommandIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault(); // Prevent textarea blur
                  selectCommand(cmd.name);
                }}
              >
                {cmd.type === 'skill' && (
                  <Wrench className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="shrink-0 font-mono font-medium">{cmd.name}</span>
                <span className="truncate text-muted-foreground">{cmd.description}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-3xl bg-muted p-2">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="Type / for commands or send a message..."
            className="flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-muted-foreground"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              autoResize();
            }}
            onKeyDown={(e) => {
              if (showCommands && filteredCommands.length > 0) {
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSelectedCommandIndex((prev) =>
                    prev > 0 ? prev - 1 : filteredCommands.length - 1,
                  );
                  return;
                }
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSelectedCommandIndex((prev) =>
                    prev < filteredCommands.length - 1 ? prev + 1 : 0,
                  );
                  return;
                }
                if (e.key === 'Tab') {
                  e.preventDefault();
                  selectCommand(filteredCommands[selectedCommandIndex]!.name);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowCommands(false);
                  return;
                }
              }
              // Input history: ArrowUp/Down when not in slash menu
              if (e.key === 'ArrowUp' && !showCommands && inputHistory.length > 0) {
                if (historyIndexRef.current === -1) {
                  savedInputRef.current = value;
                }
                const nextIndex = Math.min(historyIndexRef.current + 1, inputHistory.length - 1);
                if (nextIndex !== historyIndexRef.current || historyIndexRef.current === -1) {
                  historyIndexRef.current = nextIndex;
                  setValue(inputHistory[nextIndex]!);
                  e.preventDefault();
                }
                return;
              }
              if (e.key === 'ArrowDown' && !showCommands && historyIndexRef.current >= 0) {
                e.preventDefault();
                const nextIndex = historyIndexRef.current - 1;
                historyIndexRef.current = nextIndex;
                if (nextIndex < 0) {
                  setValue(savedInputRef.current);
                } else {
                  setValue(inputHistory[nextIndex]!);
                }
                return;
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (showCommands && filteredCommands.length > 0) {
                  selectCommand(filteredCommands[selectedCommandIndex]!.name);
                  return;
                }
                handleSend();
              }
            }}
          />
          <Button
            size="icon"
            className="size-8 shrink-0 rounded-full"
            disabled={!value.trim() || disabled || !isConnected}
            onClick={handleSend}
          >
            <Send className="size-4" />
          </Button>
        </div>
        {mounted && (
          <p className="py-2 text-center text-xs text-muted-foreground">
            <span
              className={cn(
                'mr-1 inline-block size-2 rounded-full',
                isConnected ? 'animate-pulse bg-green-500' : 'bg-red-500',
              )}
            />
            {isConnected ? 'Connected' : 'Disconnected'} &mdash; Clawix agents
            can make errors.
          </p>
        )}
      </div>
    </div>
  );
}
