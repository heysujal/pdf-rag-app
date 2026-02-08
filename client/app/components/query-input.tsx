'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUser } from '@clerk/nextjs';
import { Loader2, Send } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Backend can return: string ("Email not found"), { message }, { error, details }, or 429/503.
 * We normalize to a single string so the UI always shows a clear message; for rate limit
 * we show a friendly line instead of raw API text.
 */
function getApiMessage(data: unknown, status?: number): string {
  if (status === 429) {
    return 'Too many requests. Please wait a moment and try again.';
  }
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
    if (typeof o.error === 'string')
      return o.details ? `${o.error}: ${o.details}` : o.error;
  }
  return 'Something went wrong. Please try again.';
}

export function QueryInput() {
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? '';
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Ask me anything about your PDFs. Upload a file on the left first, then ask questions here.',
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);

  // Run scroll after the next paint so new message is in the DOM (React has committed).
  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const input = inputRef.current;
      if (!input) return;
      const query = input.value?.trim();
      if (!query || !email || isLoading) return;

      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: query,
      };
      setMessages((prev) => [...prev, userMsg]);
      input.value = '';
      setIsLoading(true);
      scrollToBottom();

      try {
        const url = `${process.env.NEXT_PUBLIC_API_URL}/ask?email=${encodeURIComponent(email)}&query=${encodeURIComponent(query)}`;
        const response = await fetch(url);
        const data = await response.json().catch(() => ({}));
        const text = getApiMessage(data, response.status);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: text,
          },
        ]);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: 'Sorry, there was an error. Please check your connection and try again.',
          },
        ]);
      } finally {
        setIsLoading(false);
        scrollToBottom();
        // Restore focus after React re-renders (input no longer disabled).
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    },
    [email, isLoading, scrollToBottom]
  );

  if (!email) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center text-muted-foreground text-sm">
        Sign in to chat with your PDFs.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-muted/30">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto overscroll-contain p-4"
        aria-label="Chat messages"
      >
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex',
                msg.role === 'user' ? 'justify-end' : 'justify-start'
              )}
            >
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-card-foreground border border-border'
                )}
              >
                <p className="whitespace-pre-wrap wrap-break-word">{msg.content}</p>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl bg-card border border-border px-4 py-2.5 text-muted-foreground text-sm">
                <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
                <span>Thinking…</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="shrink-0 border-t border-border bg-background p-3"
      >
        <div className="mx-auto flex max-w-2xl gap-2">
          <Input
            ref={inputRef}
            type="text"
            placeholder="Ask about your PDF…"
            className="min-w-0 flex-1"
            aria-label="Ask a question"
          />
          <Button
            type="submit"
            size="icon"
            className="shrink-0"
            aria-label="Send message"
          >
          <Send className="size-4"/>
          </Button>
        </div>
      </form>
    </div>
  );
}
