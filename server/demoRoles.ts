import { decodeSdJwt } from '@sd-jwt/core';
import { HolderWallet } from '../src/holder/wallet';
import { hasher, randomBytes, sha256Base64Url } from '../src/shared/crypto';
import { describeSeal } from '../src/shared/sealing';
import { PROTECTED_CLAIMS, describeClaim } from '../src/shared/schema';

/**
 * API 시연용 홀더.
 *
 * 폰 흐름(/wallet)에서는 홀더 키가 폰의 IndexedDB 에만 있다. 여기서는 내용 확인을 위해
 * 서버가 지갑 역할을 대신 든다. 같은 HolderWallet 코드를 쓰므로 발급·제시 결과는 동일하다.
 */
export interface DemoHolder {
  holderId: string;
  wallet: HolderWallet;
  createdAt: number;
}

export class DemoHolders {
  private readonly holders = new Map<string, DemoHolder>();

  create(): DemoHolder {
    const holderId = [...randomBytes(6)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const holder: DemoHolder = { holderId, wallet: new HolderWallet(), createdAt: Date.now() };
    this.holders.set(holderId, holder);
    return holder;
  }

  get(holderId: string): DemoHolder | undefined {
    return this.holders.get(holderId);
  }
}

/** 자격증명 한 장을 사람이 읽을 수 있게 풀어 놓는다. 값·salt·다이제스트까지 전부. */
export async function describeCredential(raw: string) {
  const decoded = await decodeSdJwt(raw, hasher);
  const payload = decoded.jwt.payload as Record<string, unknown>;

  const selective: Record<string, { value: unknown; salt: string; digest: string }> = {};
  for (const disclosure of decoded.disclosures) {
    if (disclosure.key === undefined) continue;
    selective[disclosure.key] = {
      value: disclosure.value,
      salt: disclosure.salt,
      digest: sha256Base64Url(disclosure.encode()),
    };
  }

  const sealed: Record<string, ReturnType<typeof describeSeal> & { preview: string }> = {};
  const plaintext: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === '_sd' || key === '_sd_alg') continue;
    if ((PROTECTED_CLAIMS as readonly string[]).includes(key)) continue;
    if (describeClaim(key).mode === 'sealed') {
      const jwe = String(value);
      sealed[key] = { ...describeSeal(jwe), preview: `${jwe.slice(0, 48)}…` };
    } else {
      plaintext[key] = value;
    }
  }

  return {
    issuerDid: payload.iss,
    vct: payload.vct,
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    holderBinding: payload.cnf,
    sdDigestsInBody: payload._sd,
    selective,
    sealed,
    plaintext,
    raw,
  };
}
