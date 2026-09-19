import { randomBytes } from '../shared/crypto';
import type { PresentationRequest } from '../shared/types';

export interface CreateRequestInput {
  verifier: string;
  purpose: string;
  requested: readonly string[];
  /** 요청 유효시간. 기본 5분 — 세션 서버 TTL 과 맞춘다. (§13) */
  ttlSeconds?: number;
  now?: Date;
}

const DEFAULT_REQUEST_TTL_SECONDS = 5 * 60;

/**
 * 사장님이 만드는 제시 요청 (§7)
 *
 * `purpose` 는 지갑 승인 화면에 그대로 표시된다. 왜 달라는지 못 적으면
 * 지원자 입장에서 정상 요구와 사기 요구를 구분할 방법이 없다. (§3)
 */
export function createPresentationRequest(input: CreateRequestInput): PresentationRequest {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlSeconds ?? DEFAULT_REQUEST_TTL_SECONDS) * 1000);

  return {
    verifier: input.verifier,
    purpose: input.purpose,
    requested: [...input.requested],
    nonce: generateNonce(),
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * 검증자마다 매번 다른 값. Phase 3 에서 홀더가 이 값에 서명(KB-JWT)하게 되고,
 * 그래서 사장님이 받은 VP 를 다른 곳에 복사해도 통과하지 못한다. (§8-3)
 */
export function generateNonce(): string {
  const bytes = randomBytes(8);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
