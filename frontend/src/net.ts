import type { ClientMessage, ErrorCode, GuessOutcome, RoomView, ServerMessage, Slot } from '@flagduel/shared';

export const WORKER_URL = ((import.meta.env.VITE_WORKER_URL as string | undefined) || 'http://localhost:8787').replace(
  /\/$/,
  '',
);

export const flagSrc = (token: string) => `${WORKER_URL}/flags/${token}`;

const SESSION_KEY = 'flagduel.session';
let memorySession: string | null = null;

/**
 * Per-tab id used to reclaim your seat after a reload or network drop. Kept in
 * sessionStorage (not localStorage) so two tabs of one browser are two players.
 */
export function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return (memorySession ??= crypto.randomUUID());
  }
}

export async function createRoom(): Promise<string> {
  const res = await fetch(`${WORKER_URL}/rooms`, { method: 'POST' });
  if (!res.ok) throw new Error(`Could not create a lobby (${res.status})`);
  return ((await res.json()) as { code: string }).code;
}

export async function roomExists(code: string): Promise<boolean> {
  const res = await fetch(`${WORKER_URL}/rooms/${code}`);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`Server error (${res.status})`);
  return true;
}

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

interface Handlers {
  onState(room: RoomView, you: Slot): void;
  onStatus(status: ConnStatus): void;
  /** Fatal errors end the connection (room full, not found, …); others are informational. */
  onError(code: ErrorCode, message: string, fatal: boolean): void;
  onOppWrong(round: number): void;
}

const FATAL: ErrorCode[] = ['room_full', 'not_found', 'in_progress'];

export class RoomConnection {
  private ws: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private guessWaiters: ((o: GuessOutcome) => void)[] = [];
  /** serverTime - localTime, updated from every snapshot */
  offset = 0;

  constructor(
    readonly code: string,
    private name: string,
    private h: Handlers,
  ) {
    this.open();
  }

  private open() {
    this.h.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(`${WORKER_URL.replace(/^http/, 'ws')}/rooms/${this.code}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.send({ t: 'hello', name: this.name, sessionId: getSessionId() });
      this.h.onStatus('open');
      this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 30_000);
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data as string) as ServerMessage);
    ws.onclose = (e) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.flushGuesses('ignored');
      if (this.ws !== ws || this.stopped) return;
      if (e.code === 4003 || e.code === 4004) return this.stop();
      this.attempt++;
      this.h.onStatus('reconnecting');
      const delay = Math.min(500 * 2 ** (this.attempt - 1), 4000);
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
  }

  private onMessage(m: ServerMessage) {
    switch (m.t) {
      case 'state':
        this.offset = m.now - Date.now();
        this.h.onState(m.room, m.you);
        break;
      case 'guessResult':
        this.guessWaiters.shift()?.(m.outcome);
        break;
      case 'oppWrong':
        this.h.onOppWrong(m.round);
        break;
      case 'error': {
        const fatal = FATAL.includes(m.code);
        this.h.onError(m.code, m.message, fatal);
        if (fatal) this.stop();
        break;
      }
    }
  }

  send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Send a guess and resolve with the server's verdict. */
  guess(round: number, text: string): Promise<GuessOutcome> {
    if (this.ws?.readyState !== WebSocket.OPEN) return Promise.resolve('ignored');
    return new Promise((resolve) => {
      this.guessWaiters.push(resolve);
      this.send({ t: 'guess', round, text });
    });
  }

  private flushGuesses(o: GuessOutcome) {
    const w = this.guessWaiters;
    this.guessWaiters = [];
    w.forEach((f) => f(o));
  }

  /** Convert a server timestamp to the local clock. */
  toLocal(serverMs: number | null): number | null {
    return serverMs === null ? null : serverMs - this.offset;
  }

  stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.flushGuesses('ignored');
    this.ws?.close(1000, 'leave');
    this.h.onStatus('closed');
  }
}
