import type { JWK } from 'jose';
import type { ResidentIdSelectiveClaim } from './schema';
import type { ChainCall } from './revocation';

/** `<본체 JWT>~<조각>~<조각>~` 형태의 SD-JWT 직렬화 문자열. */
export type SdJwtCompact = string;

/** 주민센터가 이미 갖고 있는 값. 사용자가 사진을 올리는 일은 없다. (§11) */
export interface ResidentIdSubject {
  name: string;
  address: string;
  birthDate: string;
  /** 주민등록번호 13자리. Phase 4 부터 국세청 공개키로 봉인해서 넣는다. */
  rrn: string;
  photo?: string;
  documentIssuedOn?: string;
  issuingAuthority?: string;
}

/** 신분 VC 본체에 실리는 클레임. */
export interface ResidentIdVcPayload {
  iss: string;
  iat: number;
  exp: number;
  vct: string;
  cnf: { jwk: JWK };
  statusIndex: number;
  name: string;
  address: string;
  isOver18: boolean;
  birthDate: string;
  [key: string]: unknown;
}

export interface StoredCredential {
  id: string;
  vct: string;
  issuerDid: string;
  issuedAt: number;
  expiresAt: number;
  statusIndex: number;
  credential: SdJwtCompact;
  /** 조각으로 갖고 있는 선택적 공개 항목 — 지갑은 값을 안다. */
  selectiveClaims: Record<string, unknown>;
  /** 봉인된 채 항상 따라가는 항목의 키 (rrn_sealed). */
  sealedClaims: string[];
  /** 봉인도 조각도 아닌, 항상 평문으로 따라가는 항목 (statusIndex). */
  plaintextClaims: Record<string, unknown>;
}

/** 검증 결과 화면(§10)의 체크 한 줄. */
export interface VerificationCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** 조각 하나 = [salt, key, value] 를 base64url 한 것. */
export interface DisclosedClaim {
  key: string;
  value: unknown;
  salt: string;
  digest: string;
}

/**
 * 공개 범위 감사 결과 — 필수 제출물 "공개 범위 인터페이스"의 데이터 원본.
 * 검증자가 **실제로 무엇을 봤는지**를 코드로 증명한다.
 */
export interface DisclosureAudit {
  /** 조각이 함께 와서 값까지 보이는 항목. */
  disclosed: DisclosedClaim[];
  /** 본체에 해시만 남아 있는 항목 — 값도 이름도 알 수 없다. */
  withheldDigests: string[];
  /** 잠긴 채 전달된 항목 — 검증자가 갖고 있지만 열 수 없다. 값은 JWE 문자열. */
  sealed: Record<string, string>;
  /** 선택 대상도 봉인도 아니라 항상 평문으로 따라온 필드. */
  alwaysPresent: Record<string, unknown>;
}

/**
 * 요청 충족 여부는 **암호적 유효성과 별개**다.
 * 주소를 요청했는데 안 왔다고 해서 VC 가 위조된 것은 아니다 — 홀더가 거부한 것이고,
 * 그걸 받아들일지는 사장님의 정책 판단이다.
 */
export interface RequestSatisfaction {
  satisfied: boolean;
  received: string[];
  missing: string[];
}

export interface VerificationReport {
  /** 암호적으로 유효한가 — 서명·유효기간·해시 대조. */
  ok: boolean;
  checks: VerificationCheck[];
  audit: DisclosureAudit;
  payload?: Record<string, unknown>;
  /** 제시 요청을 같이 넘겼을 때만 채워진다. */
  request?: RequestSatisfaction;
  /** 폐기 조회를 했을 때만 채워진다. 하단 체인 바에 표시된다. */
  chainCall?: ChainCall;
}

export interface PresentationOptions {
  disclose: readonly ResidentIdSelectiveClaim[];
}

// ────────────────────────────────────────────────────────────────────
// 제시 요청 / 응답 (§7)
// ────────────────────────────────────────────────────────────────────

/**
 * 사장님(Verifier) → 지갑(Holder)
 *
 * ```json
 * {
 *   "verifier": "행사운영팀",
 *   "purpose": "일당 지급 및 원천징수 신고",
 *   "requested": ["name", "isOver18", "rrn_sealed", "accountHolderName"],
 *   "nonce": "8472",
 *   "expiresAt": "2026-09-20T14:05:00Z"
 * }
 * ```
 */
export interface PresentationRequest {
  verifier: string;
  /** 왜 달라는지. 지갑 승인 화면에 그대로 표시된다. */
  purpose: string;
  requested: string[];
  /** Phase 3 에서 KB-JWT 로 서명된다. */
  nonce: string;
  expiresAt: string;
}

/** 승인 화면 한 줄. */
export interface ApprovalItem {
  key: string;
  label: string;
  /** 값을 아는 항목만 채워진다. 안 보낼 항목도 지갑은 값을 알고 있다. */
  value?: unknown;
  note?: string;
}

/**
 * 지갑 승인 화면 모델 — 필수 제출물 "공개 범위 인터페이스"의 3칸. (§10)
 *
 * 요청의 `requested` 배열과 지갑이 실제로 가진 항목을 비교해 매번 새로 만든다.
 * 하드코딩된 목록은 없다.
 */
export interface ApprovalPlan {
  verifier: string;
  purpose: string;
  expiresAt: string;
  requestExpired: boolean;
  /** 이 요청의 nonce. 홀더가 KB-JWT 로 서명한다. (§8-3) */
  nonce: string;
  /** 보여줄 정보 — 값까지 검증자에게 간다. */
  shown: ApprovalItem[];
  /** 잠긴 채 전달 — 검증자는 갖고 있지만 열 수 없다. (Phase 4) */
  sealed: ApprovalItem[];
  /** 보내지 않음 — 요청에 없거나 홀더가 거부한 항목. 해시만 남는다. */
  withheld: ApprovalItem[];
  /**
   * 골라낼 수 없이 항상 함께 가는 평문 항목 (statusIndex).
   * 개인정보는 아니지만 검증자에게 가는 건 사실이므로 화면에서 숨기지 않는다.
   */
  alwaysSent: ApprovalItem[];
  /** 요청받았지만 지갑에 없는 항목. */
  unavailable: ApprovalItem[];
  /** 실제로 조각을 붙여 보낼 키 목록. */
  disclose: string[];
}
