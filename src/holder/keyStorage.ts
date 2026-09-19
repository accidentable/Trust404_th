import { get, set, del } from 'idb-keyval';
import { ed25519 } from '@noble/curves/ed25519';
import { didKeyFromEd25519PublicKey } from '../shared/did';
import { randomBytes } from '../shared/crypto';
import type { Ed25519KeyPair } from '../shared/keys';

/**
 * 홀더 개인키 보관 (§6, §13)
 *
 * 지갑의 개인키는 **IndexedDB 에만** 있다. 서버로 올라가지 않고,
 * 세션 서버에도, 검증자에게도 가지 않는다.
 *
 * 저장하는 것은 Ed25519 seed 32바이트뿐이다. 공개키와 DID 는 seed 에서 매번 계산한다.
 * 브라우저 개발자도구 → Application → IndexedDB 에서 직접 확인할 수 있다.
 */
export const HOLDER_SEED_KEY = 'trust404.holder.seed';

export async function loadOrCreateHolderKeyPair(): Promise<{
  keyPair: Ed25519KeyPair;
  created: boolean;
}> {
  const existing = await get<number[]>(HOLDER_SEED_KEY);

  if (existing && existing.length === 32) {
    return { keyPair: keyPairFromSeed(Uint8Array.from(existing)), created: false };
  }

  const seed = randomBytes(32);
  await set(HOLDER_SEED_KEY, [...seed]);
  return { keyPair: keyPairFromSeed(seed), created: true };
}

export async function forgetHolderKey(): Promise<void> {
  await del(HOLDER_SEED_KEY);
}

function keyPairFromSeed(privateKey: Uint8Array): Ed25519KeyPair {
  const publicKey = ed25519.getPublicKey(privateKey);
  return { did: didKeyFromEd25519PublicKey(publicKey), publicKey, privateKey };
}
