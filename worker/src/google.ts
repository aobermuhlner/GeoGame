// Verifies Google Identity Services ID tokens (RS256 JWTs) without any SDK.
// https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

export interface GoogleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  picture?: string;
}

export type Jwk = JsonWebKey & { kid?: string };
export type KeySource = () => Promise<Jwk[]>;

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
/** Allowed clock difference to Google, in seconds */
const SKEW_S = 60;

let cached: { keys: Jwk[]; until: number } | null = null;

/** Google's current signing keys, cached for as long as their Cache-Control allows. */
export async function googleKeys(): Promise<Jwk[]> {
  if (cached && Date.now() < cached.until) return cached.keys;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error(`Google certs: ${res.status}`);
  const { keys } = (await res.json()) as { keys: Jwk[] };
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1];
  cached = { keys, until: Date.now() + (maxAge ? Number(maxAge) * 1000 : 3_600_000) };
  return keys;
}

function b64urlBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function b64urlJson(s: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(new TextDecoder().decode(b64urlBytes(s)));
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Returns the token's claims if it is a valid, unexpired Google ID token for `clientId`; otherwise null. */
export async function verifyGoogleIdToken(
  jwt: string,
  clientId: string,
  now = Date.now(),
  keys: KeySource = googleKeys,
): Promise<GoogleClaims | null> {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  const header = b64urlJson(parts[0]);
  const claims = b64urlJson(parts[1]);
  if (!header || !claims || header.alg !== 'RS256' || typeof header.kid !== 'string') return null;

  const jwk = (await keys()).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
    'verify',
  ]);
  let signature: Uint8Array;
  try {
    signature = b64urlBytes(parts[2]);
  } catch {
    return null;
  }
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;

  const t = now / 1000;
  if (!ISSUERS.includes(claims.iss as string)) return null;
  if (claims.aud !== clientId) return null;
  if (typeof claims.exp !== 'number' || claims.exp < t - SKEW_S) return null;
  if (typeof claims.iat === 'number' && claims.iat > t + SKEW_S) return null;
  if (typeof claims.sub !== 'string' || !claims.sub) return null;
  return claims as unknown as GoogleClaims;
}
