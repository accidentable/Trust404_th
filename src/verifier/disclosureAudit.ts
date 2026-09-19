import { base64url } from 'jose';
import { sha256Base64Url } from '../shared/crypto';
import { PROTECTED_CLAIMS, describeClaim } from '../shared/schema';
import type { DisclosedClaim, DisclosureAudit, SdJwtCompact } from '../shared/types';

export interface SplitPresentation {
  jwt: string;
  disclosures: string[];
  /** Phase 3 에서 채워진다. */
  keyBindingJwt?: string;
}

/**
 * `<본체 JWT>~<조각>~<조각>~<KB-JWT>` 를 부분으로 쪼갠다.
 * 조각은 점(.)이 없는 base64url 한 덩어리, KB-JWT 는 점 두 개짜리 JWT 라서 구분된다.
 */
export function splitPresentation(presentation: SdJwtCompact): SplitPresentation {
  const parts = presentation.split('~');
  const jwt = parts[0];
  if (!jwt) throw new Error('SD-JWT 본체가 비어 있습니다');

  const rest = parts.slice(1).filter((part) => part.length > 0);
  const last = rest.at(-1);
  const hasKeyBinding = last !== undefined && last.split('.').length === 3;

  return {
    jwt,
    disclosures: hasKeyBinding ? rest.slice(0, -1) : rest,
    ...(hasKeyBinding ? { keyBindingJwt: last } : {}),
  };
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const segment = jwt.split('.')[1];
  if (!segment) throw new Error('JWT 형식이 아닙니다');
  return JSON.parse(new TextDecoder().decode(base64url.decode(segment))) as Record<string, unknown>;
}

export function decodeJwtHeader(jwt: string): Record<string, unknown> {
  const segment = jwt.split('.')[0];
  if (!segment) throw new Error('JWT 형식이 아닙니다');
  return JSON.parse(new TextDecoder().decode(base64url.decode(segment))) as Record<string, unknown>;
}

/**
 * 조각 해시 대조 — 라이브러리에 맡기지 않고 직접 다시 계산한다. (Phase 1 완료 조건)
 *
 * 조각 하나는 `base64url(JSON.stringify([salt, key, value]))` 이고,
 * 본체의 `_sd` 배열에는 `base64url(SHA-256(그 문자열))` 만 들어 있다.
 * 여기서 두 값을 맞춰 보면, 검증자가 실제로 무엇을 봤고 무엇을 못 봤는지가 나온다.
 */
export function auditDisclosures(presentation: SdJwtCompact): DisclosureAudit {
  const { jwt, disclosures } = splitPresentation(presentation);
  const payload = decodeJwtPayload(jwt);

  const sdDigests = new Set<string>(
    Array.isArray(payload._sd) ? (payload._sd as unknown[]).map(String) : [],
  );

  const disclosed: DisclosedClaim[] = [];
  for (const encoded of disclosures) {
    // 해시 대상은 디코딩한 JSON 이 아니라 인코딩된 문자열 그 자체다.
    const digest = sha256Base64Url(encoded);
    if (!sdDigests.has(digest)) {
      throw new Error(
        `조각 해시 불일치 — 본체 _sd 에 없는 조각입니다 (digest=${digest}). 값이 변조되었습니다.`,
      );
    }

    const parsed = JSON.parse(new TextDecoder().decode(base64url.decode(encoded))) as unknown[];
    if (parsed.length !== 3) {
      throw new Error('객체 속성 조각은 [salt, key, value] 3개 항목이어야 합니다');
    }
    const [salt, key, value] = parsed as [string, string, unknown];

    disclosed.push({ key, value, salt, digest });
    sdDigests.delete(digest);
  }

  // 평문으로 따라온 필드를 "잠긴 것"과 "그냥 보이는 것"으로 나눈다.
  // 둘 다 검증자 손에 있지만, 봉인은 열리지 않는다. (§8-2)
  const sealed: Record<string, string> = {};
  const alwaysPresent: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === '_sd' || key === '_sd_alg') continue;
    if ((PROTECTED_CLAIMS as readonly string[]).includes(key)) continue;
    if (describeClaim(key).mode === 'sealed') {
      sealed[key] = String(value);
    } else {
      alwaysPresent[key] = value;
    }
  }

  // 남은 다이제스트 = 홀더가 보내지 않은 항목. 검증자에게는 해시 한 줄뿐이다.
  return { disclosed, withheldDigests: [...sdDigests], sealed, alwaysPresent };
}
