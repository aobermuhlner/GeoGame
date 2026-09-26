import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { expect } from 'vitest';
import type { ClientMessage, ServerMessage } from '@flagduel/shared';
import type { Room } from '../src/room';

export const ORIGIN = 'http://localhost:5173';
export const BASE = 'https://flag-duel.test';

export async function createRoom(): Promise<string> {
  const res = await exports.default.fetch(new Request(`${BASE}/rooms`, { method: 'POST', headers: { Origin: ORIGIN } }));
  expect(res.status).toBe(200);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  const { code } = (await res.json()) as { code: string };
  return code;
}

/** A test client that records every server message and lets tests await specific ones. */
export class Client {
  messages: ServerMessage[] = [];
  closed: { code: number } | null = null;
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  constructor(public ws: WebSocket) {
    ws.accept();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data as string) as ServerMessage;
      this.messages.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
    });
    ws.addEventListener('close', (e) => {
      this.closed = { code: e.code };
    });
  }

  static async connect(code: string): Promise<Client> {
    const res = await exports.default.fetch(
      new Request(`${BASE}/rooms/${code}/ws`, { headers: { Upgrade: 'websocket', Origin: ORIGIN } }),
    );
    expect(res.status).toBe(101);
    return new Client(res.webSocket!);
  }

  send(m: ClientMessage) {
    this.ws.send(JSON.stringify(m));
  }

  next<T extends ServerMessage['t']>(t: T, pred: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true) {
    return new Promise<Extract<ServerMessage, { t: T }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout waiting for ${t}`)), 2000);
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as Extract<ServerMessage, { t: T }>),
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMessage, { t: T }>);
        },
      });
    });
  }

  /** Send and wait for the resulting snapshot that satisfies `pred`. */
  async state(m: ClientMessage | null, pred: (s: Extract<ServerMessage, { t: 'state' }>) => boolean = () => true) {
    const p = this.next('state', pred);
    if (m) this.send(m);
    return p;
  }
}

export async function join(code: string, name: string, sessionId = `sess-${name}-${Math.random().toString(36).slice(2)}`) {
  const c = await Client.connect(code);
  const s = await c.state({ t: 'hello', name, sessionId }, (s) => s.room.players.some((p) => p.name === name));
  return { c, you: s.you, sessionId };
}

export const stub = (code: string) => env.ROOMS.getByName(code);

/** Run the room's clock forward to `at` (instead of waiting for the alarm). */
export async function tickAt(code: string, at: (st: NonNullable<Awaited<ReturnType<Room['debugState']>>>) => number) {
  await runInDurableObject(stub(code), async (room: Room) => {
    const st = (await room.debugState())!;
    await room.tick(at(st));
  });
}

export const internal = (code: string) =>
  runInDurableObject(stub(code), (room: Room) => room.debugState()).then((s) => s!);
