import { SignJWT, importJWK, base64url } from 'jose';
import type { Ed25519KeyPair } from './keys';
import { publicJwkFromEd25519 } from './keys';
import { sha256Base64Url } from './crypto';
import type { PresentationRequest, VerificationCheck } from './types';

export const TAX_AUDIENCE = 'urn:trust404:tax';
export interface PayRequest {
  id: string; business: string; month: string; amount: number; phone: string;
  workerKey: string; request: PresentationRequest; signedRequest: string;
  state: 'pending' | 'correction' | 'accepted'; createdAt: string;
  workerName?: string;
  correctionMessage?: string;
  receipt?: { id: string; name: string; acceptedAt: string; jwt: string };
  checks?: VerificationCheck[];
}
export function requestHash(signedRequest: string): string { return sha256Base64Url(signedRequest); }
export async function signJwt(key: Ed25519KeyPair, payload: Record<string, unknown>, audience: string, ttl = 600): Promise<string> {
  const privateJwk = { ...publicJwkFromEd25519(key.publicKey), d: base64url.encode(key.privateKey) };
  return new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
    .setIssuer(key.did).setAudience(audience).setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(await importJWK(privateJwk, 'EdDSA'));
}
export async function approveRequest(key: Ed25519KeyPair, item: PayRequest, vp: string): Promise<string> {
  return signJwt(key, { request_id: item.id, request_hash: requestHash(item.signedRequest), presentation_hash: sha256Base64Url(vp), decision: 'approve' }, TAX_AUDIENCE);
}
