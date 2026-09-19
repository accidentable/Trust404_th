import { del, get, set } from 'idb-keyval';
import type { SdJwtCompact } from '../shared/types';

/**
 * 관객 폰 지갑의 신분증 보관 — IndexedDB.
 * 같은 폰으로 QR 을 다시 찍어도 재발급하지 않는다 (발급기관이 바뀌거나 만료가 임박하면 예외).
 */
export const WALLET_CREDENTIAL_KEY = 'trust404.wallet.credential';

export interface PersistedCredential {
  credential: SdJwtCompact;
  name: string;
  issuerDid: string;
  /** 서버 발급 형식 버전. 없으면(구버전 저장분) 재발급 대상이다. */
  version?: number;
}

export async function loadPersistedCredential(): Promise<PersistedCredential | undefined> {
  return (await get<PersistedCredential>(WALLET_CREDENTIAL_KEY)) ?? undefined;
}

export async function persistCredential(value: PersistedCredential): Promise<void> {
  await set(WALLET_CREDENTIAL_KEY, value);
}

export async function forgetCredential(): Promise<void> {
  await del(WALLET_CREDENTIAL_KEY);
}
