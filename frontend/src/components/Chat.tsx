// Group lobby chat: a card in the lobby, a pop-up during the match and on the podium.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { MAX_CHAT_LENGTH, type ChatLine } from '@flagduel/shared';
import { NO_AUTOFILL } from '../noAutofill';
import { Avatar } from './common';

const timeOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The lines and the input. `draft` lives with the caller, so it survives the panel closing. */
export function ChatPanel({
  lines,
  you,
  draft,
  setDraft,
  onSend,
  autoFocus = false,
}: {
  lines: ChatLine[];
  you: number;
  draft: string;
  setDraft: (text: string) => void;
  onSend: (text: string) => void;
  autoFocus?: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  // Follow new lines unless the reader scrolled up to read older ones.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  function send(e: Event) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    stick.current = true;
  }

  return (
    <div class="chat">
      <ol
        class="chat-lines"
        ref={listRef}
        aria-live="polite"
        aria-label="Chat messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {lines.length === 0 && <li class="chat-empty muted small">No messages yet. Say hi!</li>}
        {lines.map((l) => (
          <li key={l.id} class={`chat-line${l.seat === you ? ' mine' : ''}`}>
            <Avatar seat={l.seat} name={l.name} size={22} />
            <span class="chat-body">
              <span class="chat-meta">
                <b>{l.seat === you ? 'You' : l.name}</b>
                <time>{timeOf(l.at)}</time>
              </span>
              <span class="chat-text">{l.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <form class="chat-form" onSubmit={send}>
        <input
          {...NO_AUTOFILL}
          class="chat-input"
          type="text"
          value={draft}
          maxLength={MAX_CHAT_LENGTH}
          placeholder="Message…"
          aria-label="Chat message"
          autoFocus={autoFocus}
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
        />
        <button class="btn btn-primary btn-sm" type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

/** The lobby's chat card. */
export function ChatCard(props: Parameters<typeof ChatPanel>[0]) {
  return (
    <section class="card chat-card">
      <div class="regions-head">
        <h2>Chat</h2>
      </div>
      <ChatPanel {...props} />
    </section>
  );
}

/**
 * During the match: a round button with an unread count that opens the chat. It closes when a round starts,
 * and stays out of the way of the answer input on phones (`hidden`).
 */
export function ChatDock({
  lines,
  you,
  draft,
  setDraft,
  onSend,
  hidden,
  closeKey,
}: Parameters<typeof ChatPanel>[0] & {
  hidden: boolean;
  /** Changes when the panel should close (a new round) */
  closeKey: unknown;
}) {
  const [open, setOpen] = useState(false);
  // What was already read when the dock appeared (the lobby card showed it) doesn't count as unread.
  const [seen, setSeen] = useState(() => lines.at(-1)?.id ?? 0);
  const last = lines.at(-1)?.id ?? 0;
  useEffect(() => {
    if (open) setSeen(last);
  }, [open, last]);
  useEffect(() => setOpen(false), [closeKey]);
  const unread = lines.filter((l) => l.id > seen && l.seat !== you).length;
  if (hidden) return null;
  return (
    <div class={`chat-dock${open ? ' open' : ''}`}>
      {open && (
        <section class="card chat-pop" aria-label="Chat">
          <div class="regions-head">
            <h2>Chat</h2>
            <button class="link" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>
          <ChatPanel lines={lines} you={you} draft={draft} setDraft={setDraft} onSend={onSend} autoFocus />
        </section>
      )}
      <button
        class="chat-fab"
        aria-expanded={open}
        aria-label={unread ? `Chat, ${unread} unread` : 'Chat'}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        {unread > 0 && <span class="chat-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
    </div>
  );
}
