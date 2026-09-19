import { CompactEncrypt, base64url, compactDecrypt, importJWK } from 'jose';
import type { JWK } from 'jose';
import { SEALING_ALGORITHM, SEALING_ENCRYPTION } from './keys';

/**
 * 봉인 (§8-2) — 이 프로젝트의 기여
 *
 * 주민등록번호를 **국세청 공개키로** 암호화해 VC 의 평문 필드에 넣는다.
 * 사장님은 그 값을 갖고 있지만 열 수 없고, 신고할 때 그대로 첨부하면 된다.
 * 지급자가 보관자에서 **전달자**로 돌아간다.
 *
 * "안 보내기"와 "잠가서 보내기"는 다르다:
 *
 *            주소                 주민번호
 *   방식     조각을 안 보냄        잠가서 보냄
 *   사장님   존재도 모름           갖고 있지만 못 엶
 *   국세청   안 감                 열어서 봄
 */

/** JWE Compact Serialization — 점 5개로 구분된 문자열. */
export type JweCompact = string;

export interface SealOptions {
  /** 누구를 위한 봉인인지. JWE 보호 헤더에 남아 화면에 표시된다. */
  audience?: string;
  /** 무엇을 봉인했는지. 값이 아니라 항목 이름만 들어간다. */
  purpose?: string;
}

/**
 * 봉인한다. 열 수 있는 것은 `recipientPublicJwk` 에 대응하는 개인키뿐이다.
 *
 * ECDH-ES 는 발신자가 매번 새 임시 키쌍(epk)을 만들어 수신자 공개키와
 * 키 합의를 한다. 그래서 발급기관조차 봉인 후에는 같은 값을 다시 열 수 없다
 * — 임시 개인키를 버리기 때문이다.
 */
export async function seal(
  plaintext: string,
  recipientPublicJwk: JWK,
  options: SealOptions = {},
): Promise<JweCompact> {
  const key = await importJWK(recipientPublicJwk, SEALING_ALGORITHM);
  const encrypter = new CompactEncrypt(new TextEncoder().encode(plaintext)).setProtectedHeader({
    alg: SEALING_ALGORITHM,
    enc: SEALING_ENCRYPTION,
    ...(options.audience ? { aud: options.audience } : {}),
    ...(options.purpose ? { cty: options.purpose } : {}),
  });
  return encrypter.encrypt(key);
}

export interface UnsealResult {
  ok: boolean;
  plaintext?: string;
  error?: string;
}

/**
 * 봉인을 연다. 실패는 예외가 아니라 결과값으로 돌려준다 —
 * 시연에서 "열기 → ❌ 복호화 실패"가 정상 경로이기 때문이다. (§10 장면 B)
 */
export async function unseal(jwe: JweCompact, privateJwk: JWK): Promise<UnsealResult> {
  try {
    const key = await importJWK(privateJwk, SEALING_ALGORITHM);
    const { plaintext } = await compactDecrypt(jwe, key);
    return { ok: true, plaintext: new TextDecoder().decode(plaintext) };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/**
 * 봉인의 겉면 — 누구 앞으로 된 것인지만 읽는다. 내용은 못 읽는다.
 * 사장님 화면에 "🔒 세무신고용 봉인 · 국세청"을 띄우기 위한 것이다.
 */
export function describeSeal(jwe: JweCompact): {
  algorithm: string;
  encryption: string;
  audience?: string;
  purpose?: string;
  ephemeralPublicKey?: string;
} {
  const segment = jwe.split('.')[0];
  if (!segment) throw new Error('JWE 형식이 아닙니다');
  const header = JSON.parse(
    new TextDecoder().decode(base64url.decode(segment)),
  ) as Record<string, unknown>;

  const epk = header.epk as { x?: string } | undefined;
  return {
    algorithm: String(header.alg),
    encryption: String(header.enc),
    ...(header.aud ? { audience: String(header.aud) } : {}),
    ...(header.cty ? { purpose: String(header.cty) } : {}),
    ...(epk?.x ? { ephemeralPublicKey: epk.x } : {}),
  };
}
