import { compactVerify, importJWK } from 'jose';
import type { JWK } from 'jose';
import { ed25519FromPublicJwk, publicJwkFromEd25519, SIGNING_ALGORITHM } from '../shared/keys';
import { sha256Base64Url } from '../shared/crypto';
import type { SdJwtCompact } from '../shared/types';
import { decodeJwtHeader, decodeJwtPayload, splitPresentation } from './disclosureAudit';

export const KB_JWT_TYP = 'kb+jwt' as const;

export interface KeyBindingPayload {
  iat: number;
  aud: string;
  nonce: string;
  sd_hash: string;
}

export interface KeyBindingCheckInput {
  presentation: SdJwtCompact;
  /** 본체 VC 의 `cnf.jwk` — 발급자가 "이 VC 는 이 지갑 것"이라고 박아 둔 공개키. */
  confirmationJwk: JWK | undefined;
  /** 검증자가 **자기가 방금 보낸** 요청에서 꺼낸 값. 받은 VP 에서 꺼내면 의미가 없다. */
  expectedNonce: string;
  expectedAudience: string;
  now?: number;
  maxAgeSeconds?: number;
}

export interface KeyBindingResult {
  present: boolean;
  signatureOk: boolean;
  nonceOk: boolean;
  audienceOk: boolean;
  sdHashOk: boolean;
  payload?: KeyBindingPayload;
  detail: {
    signature: string;
    nonce: string;
    audience: string;
    sdHash: string;
  };
}

/** KB-JWT 기본 유효시간 — 받아 든 즉시 검증한다는 전제. */
const DEFAULT_KB_MAX_AGE_SECONDS = 5 * 60;

/**
 * sd_hash — KB-JWT 앞에 붙은 부분 전체(`<본체 JWT>~<조각>~…~`, 끝 물결표 포함)의 해시.
 *
 * 이게 있어서 "유효한 KB-JWT 를 떼어다 다른 조각 묶음에 붙이기"가 막힌다.
 */
export function computeSdHash(presentation: SdJwtCompact): string {
  const lastSeparator = presentation.lastIndexOf('~');
  if (lastSeparator < 0) throw new Error('SD-JWT 형식이 아닙니다');
  return sha256Base64Url(presentation.slice(0, lastSeparator + 1));
}

/**
 * Holder Binding 검증 (§8-3)
 *
 * 라이브러리에 맡기지 않고 항목별로 직접 확인한다 — 어느 조건에서 걸렸는지
 * 검증 결과 화면에 한 줄씩 보여야 하기 때문이다. (§10)
 */
export async function verifyKeyBinding(input: KeyBindingCheckInput): Promise<KeyBindingResult> {
  const { keyBindingJwt } = splitPresentation(input.presentation);
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const maxAge = input.maxAgeSeconds ?? DEFAULT_KB_MAX_AGE_SECONDS;

  const result: KeyBindingResult = {
    present: keyBindingJwt !== undefined,
    signatureOk: false,
    nonceOk: false,
    audienceOk: false,
    sdHashOk: false,
    detail: { signature: '', nonce: '', audience: '', sdHash: '' },
  };

  if (!keyBindingJwt) {
    const missing = 'KB-JWT 가 없습니다 — 홀더가 nonce 에 서명하지 않았습니다';
    result.detail = { signature: missing, nonce: missing, audience: missing, sdHash: missing };
    return result;
  }

  const header = decodeJwtHeader(keyBindingJwt);
  const payload = decodeJwtPayload(keyBindingJwt) as unknown as KeyBindingPayload;
  result.payload = payload;

  // 1) 서명 — 반드시 본체 VC 의 cnf 공개키로 검증한다.
  //    KB-JWT 안에 들어 있는 키를 쓰면 공격자가 자기 키를 넣어 통과시킬 수 있다.
  if (!input.confirmationJwk) {
    result.detail.signature = 'VC 에 cnf 가 없어 홀더 공개키를 알 수 없습니다';
  } else if (header.typ !== KB_JWT_TYP) {
    result.detail.signature = `typ 이 ${KB_JWT_TYP} 가 아닙니다 (받음: ${String(header.typ)})`;
  } else {
    try {
      const holderKey = await importJWK(
        publicJwkFromEd25519(ed25519FromPublicJwk(input.confirmationJwk)),
        SIGNING_ALGORITHM,
      );
      await compactVerify(keyBindingJwt, holderKey, { algorithms: [SIGNING_ALGORITHM] });
      result.signatureOk = true;
      result.detail.signature = `cnf 공개키로 ${SIGNING_ALGORITHM} 서명 확인 (typ=${KB_JWT_TYP})`;
    } catch {
      result.detail.signature =
        'cnf 공개키로 서명이 검증되지 않습니다 — 이 VC 의 주인이 서명한 KB-JWT 가 아닙니다';
    }
  }

  // 2) nonce — 검증자가 방금 발급한 값과 같아야 한다.
  result.nonceOk = payload.nonce === input.expectedNonce;
  result.detail.nonce = result.nonceOk
    ? `nonce ${payload.nonce} 일치`
    : `nonce 불일치 — 보낸 값 ${input.expectedNonce} / 받은 값 ${String(payload.nonce)}`;

  // 3) aud — 다른 검증자에게 제시한 VP 를 가져온 것이 아닌지.
  result.audienceOk = payload.aud === input.expectedAudience;
  result.detail.audience = result.audienceOk
    ? `aud "${payload.aud}" — 나에게 제시된 것이 맞음`
    : `aud 불일치 — 나는 "${input.expectedAudience}" / 받은 값 "${String(payload.aud)}"`;

  // 4) sd_hash — 이 KB-JWT 가 바로 이 조각 구성에 대한 서명인지.
  const expectedSdHash = computeSdHash(input.presentation);
  const freshEnough = typeof payload.iat === 'number' && payload.iat + maxAge >= now;
  result.sdHashOk = payload.sd_hash === expectedSdHash && freshEnough;
  if (payload.sd_hash !== expectedSdHash) {
    result.detail.sdHash = `sd_hash 불일치 — KB-JWT 가 다른 조각 묶음에 붙어 있습니다`;
  } else if (!freshEnough) {
    result.detail.sdHash = `KB-JWT 가 오래되었습니다 (iat=${String(payload.iat)}, 허용 ${maxAge}초)`;
  } else {
    result.detail.sdHash = `제시 내용 고정 확인 (sd_hash=${expectedSdHash.slice(0, 16)}…)`;
  }

  return result;
}

/** 본체 VC 의 `cnf.jwk` 를 꺼낸다. */
export function extractConfirmationJwk(presentation: SdJwtCompact): JWK | undefined {
  const { jwt } = splitPresentation(presentation);
  const payload = decodeJwtPayload(jwt);
  const cnf = payload.cnf as { jwk?: JWK } | undefined;
  return cnf?.jwk;
}
