import type { JWK } from 'jose';
import type { SDJwtVcInstance } from '@sd-jwt/sd-jwt-vc';
import { decodeSdJwt } from '@sd-jwt/core';
import { createHolderSdJwt } from '../shared/sdjwt';
import { hasher } from '../shared/crypto';
import { PROTECTED_CLAIMS, describeClaim, nowInSeconds } from '../shared/schema';
import {
  createSigner,
  generateEd25519KeyPair,
  publicJwkFromEd25519,
  type Ed25519KeyPair,
} from '../shared/keys';

import type {
  ApprovalPlan,
  PresentationRequest,
  SdJwtCompact,
  StoredCredential,
} from '../shared/types';
import { buildApprovalPlan, type ApprovalDecisions } from './approval';

/**
 * 지갑 (Holder)
 *
 * 개인키는 이 객체 밖으로 나가지 않는다. 브라우저에서는 IndexedDB 에만 남고
 * 서버로 올라가지 않는다. (§6)
 *
 * Phase 2 에서는 메모리 저장소로 둔다. IndexedDB(`idb-keyval`) 어댑터는
 * 지갑 화면을 붙이는 Phase 5 에서 이 클래스 뒤에 끼운다.
 */
export class HolderWallet {
  readonly did: string;
  readonly name = '나';
  private readonly keyPair: Ed25519KeyPair;
  private readonly sdjwt: SDJwtVcInstance;
  private readonly credentials = new Map<string, StoredCredential>();

  constructor(keyPair: Ed25519KeyPair = generateEd25519KeyPair()) {
    this.keyPair = keyPair;
    this.did = keyPair.did;
    // kbSigner = 홀더 자신의 개인키. 발급자 키가 아니다.
    this.sdjwt = createHolderSdJwt(createSigner(keyPair.privateKey));
  }

  /** 발급자에게 넘겨줄 공개키. VC 의 `cnf` 에 박힌다. */
  get publicJwk(): JWK {
    return publicJwkFromEd25519(this.keyPair.publicKey);
  }

  /**
   * 받은 VC 를 지갑에 저장한다. 본체를 손대지 않고 그대로 보관하되,
   * 어떤 항목을 갖고 있는지는 미리 풀어 둔다 — 승인 화면을 그리려면 필요하다.
   */
  async save(credential: SdJwtCompact): Promise<StoredCredential> {
    const decoded = await decodeSdJwt(credential, hasher);
    const payload = decoded.jwt.payload as Record<string, unknown>;

    const selectiveClaims: Record<string, unknown> = {};
    for (const disclosure of decoded.disclosures) {
      if (disclosure.key === undefined) continue; // 배열 원소 조각은 여기서 다루지 않는다
      selectiveClaims[disclosure.key] = disclosure.value;
    }

    const sealedClaims: string[] = [];
    const plaintextClaims: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      if (key === '_sd' || key === '_sd_alg') continue;
      if ((PROTECTED_CLAIMS as readonly string[]).includes(key)) continue;
      if (describeClaim(key).mode === 'sealed') sealedClaims.push(key);
      else plaintextClaims[key] = value;
    }

    const stored: StoredCredential = {
      id: `cred-${this.credentials.size + 1}`,
      vct: String(payload.vct ?? ''),
      issuerDid: String(payload.iss ?? ''),
      issuedAt: Number(payload.iat ?? 0),
      expiresAt: Number(payload.exp ?? 0),
      statusIndex: Number(payload.statusIndex ?? -1),
      credential,
      selectiveClaims,
      sealedClaims,
      plaintextClaims,
    };
    this.credentials.set(stored.id, stored);
    return stored;
  }

  list(): StoredCredential[] {
    return [...this.credentials.values()];
  }

  has(id: string): boolean {
    return this.credentials.has(id);
  }

  get(id: string): StoredCredential {
    const found = this.credentials.get(id);
    if (!found) throw new Error(`지갑에 없는 credential: ${id}`);
    return found;
  }

  /**
   * 요청을 읽어 승인 화면을 만든다. 항목 목록은 요청에서 나오지 하드코딩이 아니다. (§7)
   * 아직 아무것도 보내지 않는다 — 홀더가 [제시하기]를 누르기 전 단계다.
   */
  reviewRequest(
    credentialId: string,
    request: PresentationRequest,
    decisions: ApprovalDecisions = {},
    now: Date = new Date(),
  ): ApprovalPlan {
    return buildApprovalPlan(this.get(credentialId), request, decisions, now);
  }

  /**
   * 승인한 내용대로 VP 를 만든다.
   *
   * 응답 포맷 (§7): `<본체 JWT>~<조각: name>~<조각: isOver18>~<KB-JWT>`
   *
   * 맨 뒤 KB-JWT 는 홀더 개인키로 `{ nonce, aud, iat }` 에 서명한 것이다.
   * 검증자마다 다른 nonce 를 주므로, 사장님이 받은 VP 를 다른 검증자에게
   * 복사해 넣어도 통과하지 않는다. (§8-3)
   */
  async presentPlan(credentialId: string, plan: ApprovalPlan): Promise<SdJwtCompact> {
    if (plan.requestExpired) {
      throw new Error(`제시 요청이 만료되었습니다 (expiresAt=${plan.expiresAt})`);
    }
    return this.present(credentialId, plan.disclose, {
      nonce: plan.nonce,
      audience: plan.verifier,
    });
  }

  /**
   * 제시(VP) 생성 — `disclose` 에 넣은 항목의 조각만 붙여 보낸다.
   *
   * 본체 JWT 는 그대로 두므로 발급자 서명은 유효하고,
   * 빠진 항목은 검증자 쪽에 해시로만 남는다.
   *
   * `binding` 을 넘기지 않으면 KB-JWT 없는 VP 가 나온다 (Phase 2 까지의 형태).
   */
  async present(
    credentialId: string,
    disclose: readonly string[],
    binding?: { nonce: string; audience: string; iat?: number },
  ): Promise<SdJwtCompact> {
    const stored = this.get(credentialId);
    const frame = Object.fromEntries(disclose.map((key) => [key, true]));

    if (!binding) return this.sdjwt.present(stored.credential, frame);

    // sd_hash 는 라이브러리가 계산해 넣는다 — 이 VP 의 조각 구성 전체를 묶는 값이라
    // KB-JWT 만 떼어 다른 조각에 붙이는 것도 막힌다.
    return this.sdjwt.present(stored.credential, frame, {
      kb: {
        payload: {
          nonce: binding.nonce,
          aud: binding.audience,
          iat: binding.iat ?? nowInSeconds(),
        },
      },
    });
  }
}
