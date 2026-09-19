import { sha256 } from '@noble/hashes/sha256';
import { base64url } from 'jose';
import type { Hasher, SaltGenerator } from '@sd-jwt/core';

/** 브라우저와 Node 양쪽에서 같은 코드로 동작하도록 WebCrypto 만 쓴다. */
export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function toBytes(data: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof data === 'string') return utf8(data);
  if (data instanceof Uint8Array) return data;
  return new Uint8Array(data);
}

/**
 * SD-JWT 의 조각 다이제스트 = base64url( SHA-256( 조각의 base64url 문자열 ) ).
 * 해시 대상은 디코딩한 JSON 이 아니라 **인코딩된 문자열 그대로**다.
 */
export function sha256Base64Url(data: string | Uint8Array): string {
  return base64url.encode(sha256(toBytes(data)));
}

export const hasher: Hasher = (data, alg) => {
  if (alg !== 'sha-256') throw new Error(`지원하지 않는 해시 알고리즘: ${alg}`);
  return sha256(toBytes(data));
};

/**
 * 조각마다 붙는 salt. 없으면 isOver18 처럼 값의 경우의 수가 적은 항목은
 * 해시만 보고도 대입으로 맞힐 수 있다. (§8-1)
 */
export const saltGenerator: SaltGenerator = (length) => base64url.encode(randomBytes(length));

export const HASH_ALGORITHM = 'sha-256' as const;
