// HTTP client for accounts, the daily challenge and leaderboards.
import type {
  AuthConfig,
  BoardId,
  ChallengeResultResponse,
  ChallengesResponse,
  DailyGuessResponse,
  DailyResponse,
  DailySummary,
  HigherBoardResponse,
  HigherPickResponse,
  HigherResponse,
  LeaderboardResponse,
  LoginResponse,
  MeResponse,
  ModeId,
  RankedBoardResponse,
  RankedProfile,
  UserView,
} from '@flagduel/shared';
import { WORKER_URL } from './net';

const TOKEN_KEY = 'flagduel.auth';

export function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — signed in for this page only */
  }
}

let token = loadToken();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Called when the server says the session is gone (expired or signed out elsewhere). */
let onSignedOut: () => void = () => {};
export const setSignedOutHandler = (f: () => void) => (onSignedOut = f);

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${WORKER_URL}${path}`, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server.');
  }
  if (!res.ok) {
    const message = await res
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => null);
    if (res.status === 401 && token && path !== '/auth/google') {
      token = null;
      storeToken(null);
      onSignedOut();
    }
    throw new ApiError(res.status, message ?? `Server error (${res.status})`);
  }
  return res.json() as Promise<T>;
}

function signedIn(r: LoginResponse): UserView {
  token = r.token;
  storeToken(r.token);
  return r.user;
}

export const api = {
  hasSession: () => token !== null,
  /** The session token (the ranked queue sends it over its WebSocket) */
  token: () => token,
  config: () => request<AuthConfig>('/auth/config'),
  loginGoogle: (credential: string) =>
    request<LoginResponse>('/auth/google', { method: 'POST', body: { credential } }).then(signedIn),
  /** Guest → Google account; the guest session is replaced by the returned one. */
  linkGoogle: (credential: string) =>
    request<LoginResponse>('/auth/google/link', { method: 'POST', body: { credential } }).then(signedIn),
  loginGuest: (name: string) => request<LoginResponse>('/auth/guest', { method: 'POST', body: { name } }).then(signedIn),
  loginDev: (name: string) => request<LoginResponse>('/auth/dev', { method: 'POST', body: { name } }).then(signedIn),
  async logout() {
    await request('/auth/logout', { method: 'POST' }).catch(() => {});
    token = null;
    storeToken(null);
  },
  me: () => request<MeResponse>('/me'),
  rename: (displayName: string) =>
    request<{ user: UserView }>('/me', { method: 'PATCH', body: { displayName } }).then((r) => r.user),

  dailySummary: () => request<DailySummary>('/daily'),
  challenges: () => request<ChallengesResponse>('/challenges'),
  challengeResult: (id: string, codes: string[], timeMs: number) =>
    request<ChallengeResultResponse>(`/challenges/${id}/result`, { method: 'POST', body: { codes, timeMs } }),
  dailyStart: (mode: ModeId) => request<DailyResponse>(`/daily/${mode}/start`, { method: 'POST' }),
  dailyGet: (mode: ModeId) => request<DailyResponse>(`/daily/${mode}`),
  dailyGuess: (mode: ModeId, round: number, text: string) =>
    request<DailyGuessResponse>(`/daily/${mode}/guess`, { method: 'POST', body: { round, text } }),
  dailyDraft: (mode: ModeId, round: number, text: string) =>
    request<{ ok: boolean }>(`/daily/${mode}/draft`, { method: 'POST', body: { round, text } }),
  dailyPass: (mode: ModeId, round: number) =>
    request<DailyResponse>(`/daily/${mode}/pass`, { method: 'POST', body: { round } }),
  dailyNext: (mode: ModeId, round: number) =>
    request<DailyResponse>(`/daily/${mode}/next`, { method: 'POST', body: { round } }),
  higherStart: () => request<HigherResponse>('/higher/daily/start', { method: 'POST' }),
  higherGet: () => request<HigherResponse>('/higher/daily'),
  higherPick: (round: number, code: string) =>
    request<HigherPickResponse>('/higher/daily/pick', { method: 'POST', body: { round, code } }),
  higherNext: (round: number) => request<HigherResponse>('/higher/daily/next', { method: 'POST', body: { round } }),
  higherBoard: () => request<HigherBoardResponse>('/higher/leaderboard'),
  leaderboard: (board: BoardId) => request<LeaderboardResponse>(`/leaderboard?board=${board}`),
  ranked: () => request<RankedProfile>('/ranked'),
  rankedBoard: (mode: ModeId) => request<RankedBoardResponse>(`/ranked/leaderboard?mode=${mode}`),
  rankedBeginner: (mode: ModeId) => request<RankedProfile>(`/ranked/${mode}/beginner`, { method: 'POST' }),
  placementStart: (mode: ModeId) => request<DailyResponse>(`/ranked/${mode}/placement/start`, { method: 'POST' }),
  placementGet: (mode: ModeId) => request<DailyResponse>(`/ranked/${mode}/placement`),
  placementGuess: (mode: ModeId, round: number, text: string) =>
    request<DailyGuessResponse>(`/ranked/${mode}/placement/guess`, { method: 'POST', body: { round, text } }),
  placementPass: (mode: ModeId, round: number) =>
    request<DailyResponse>(`/ranked/${mode}/placement/pass`, { method: 'POST', body: { round } }),
  placementNext: (mode: ModeId, round: number) =>
    request<DailyResponse>(`/ranked/${mode}/placement/next`, { method: 'POST', body: { round } }),
};

export const dailyFlagSrc = (flagToken: string) => `${WORKER_URL}/daily/flags/${flagToken}`;
/** Any flag by ISO code (public: for games that name the country anyway). */
export const codeFlagSrc = (code: string) => `${WORKER_URL}/practice/flags/${code}`;
