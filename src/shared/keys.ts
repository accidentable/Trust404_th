import { ed25519, x25519 } from '@noble/curves/ed25519';
import { base64url } from 'jose';
import type { JWK } from 'jose';
import type { Signer, Verifier } from '@sd-jwt/core';
import {
  didKeyFromEd25519PublicKey,
  didKeyFromX25519PublicKey,
  ed25519PublicKeyFromDidKey,
} from './did';
import { randomBytes, utf8 } from './crypto';

/**
 * 각 주체(주민센터·은행·지갑·국세청)는 자기 키쌍 하나만 갖는다.
 * 한 화면 안에서 돌더라도 서로의 개인키에는 접근하지 않는다. (§13)
 */
export interface Ed25519KeyPair {
  readonly did: string;
  readonly publicKey: Uint8Array;
  /** Ed25519 seed 32바이트. 실제 지갑에서는 IndexedDB 밖으로 나가지 않는다. */
  readonly privateKey: Uint8Array;
}

export const SIGNING_ALGORITHM = 'EdDSA' as const;

export function generateEd25519KeyPair(): Ed25519KeyPair {
  const privateKey = randomBytes(32);
  const publicKey = ed25519.getPublicKey(privateKey);
  return { did: didKeyFromEd25519PublicKey(publicKey), publicKey, privateKey };
}

export function publicJwkFromEd25519(publicKey: Uint8Array): JWK {
  return { kty: 'OKP', crv: 'Ed25519', x: base64url.encode(publicKey) };
}

export function ed25519FromPublicJwk(jwk: JWK): Uint8Array {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    throw new Error('Ed25519 공개 JWK 가 아닙니다');
  }
  return base64url.decode(jwk.x);
}

/** SD-JWT 라이브러리가 요구하는 시그니처: 문자열을 받아 base64url 서명을 돌려준다. */
export function createSigner(privateKey: Uint8Array): Signer {
  return (data: string) => base64url.encode(ed25519.sign(utf8(data), privateKey));
}

export function createVerifier(publicKey: Uint8Array): Verifier {
  return (data: string, signature: string) => {
    try {
      return ed25519.verify(base64url.decode(signature), utf8(data), publicKey);
    } catch {
      return false;
    }
  };
}

/** did:key 는 식별자에서 공개키가 바로 나온다 — 네트워크 조회가 없다. */
export function createVerifierForDid(did: string): Verifier {
  return createVerifier(ed25519PublicKeyFromDidKey(did));
}

// ────────────────────────────────────────────────────────────────────
// X25519 — 봉인 수신용 (§8-2)
//
// Ed25519 는 서명 전용이라 ECDH 키 합의를 할 수 없다. 국세청 봉인 수신 키는
// 같은 Curve25519 계열의 X25519 를 쓴다.
// ────────────────────────────────────────────────────────────────────

export const SEALING_ALGORITHM = 'ECDH-ES+A256KW' as const;
export const SEALING_ENCRYPTION = 'A256GCM' as const;

export interface X25519KeyPair {
  readonly did: string;
  readonly publicKey: Uint8Array;
  readonly privateKey: Uint8Array;
}

export function generateX25519KeyPair(): X25519KeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { did: didKeyFromX25519PublicKey(publicKey), publicKey, privateKey };
}

/** 공개해도 되는 쪽. 발급기관이 봉인할 때 쓴다. */
export function publicJwkFromX25519(publicKey: Uint8Array): JWK {
  return { kty: 'OKP', crv: 'X25519', x: base64url.encode(publicKey) };
}

/** 국세청 밖으로 나가면 안 되는 쪽. */
export function privateJwkFromX25519(keyPair: X25519KeyPair): JWK {
  return {
    kty: 'OKP',
    crv: 'X25519',
    x: base64url.encode(keyPair.publicKey),
    d: base64url.encode(keyPair.privateKey),
  };
}

export function x25519FromPublicJwk(jwk: JWK): Uint8Array {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'X25519' || typeof jwk.x !== 'string') {
    throw new Error('X25519 공개 JWK 가 아닙니다');
  }
  return base64url.decode(jwk.x);
}

// ────────────────────────────────────────────────────────────────────
// 고정 시드 복원 — 서버(주민센터·국세청)가 재시작해도 같은 DID 를 유지한다.
// ────────────────────────────────────────────────────────────────────

export function ed25519KeyPairFromSeed(seed: Uint8Array): Ed25519KeyPair {
  if (seed.length !== 32) throw new Error('Ed25519 seed 는 32바이트여야 합니다');
  const publicKey = ed25519.getPublicKey(seed);
  return { did: didKeyFromEd25519PublicKey(publicKey), publicKey, privateKey: seed };
}

export function x25519KeyPairFromSeed(seed: Uint8Array): X25519KeyPair {
  if (seed.length !== 32) throw new Error('X25519 seed 는 32바이트여야 합니다');
  const publicKey = x25519.getPublicKey(seed);
  return { did: didKeyFromX25519PublicKey(publicKey), publicKey, privateKey: seed };
}
