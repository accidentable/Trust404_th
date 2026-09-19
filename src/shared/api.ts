import type { JWK } from 'jose';
import type { PresentationRequest, SdJwtCompact } from './types';

/**
 * 세션 서버 API (§13)
 *
 * 시연 편의를 위한 서버다. 실제로는 QR·딥링크로 지갑과 검증자가 직접 통신한다.
 * 서버는 **중계만** 한다 — 검증은 사장님 브라우저에서, 서명은 관객 폰에서 일어난다.
 * 서버가 갖는 키는 주민센터(발급)와 국세청(봉인 수신)뿐이다.
 *
 * 관객 참여 흐름:
 *   사장님 화면  POST /api/merchant              → merchantId (요청 템플릿 등록)
 *   관객 폰      POST /api/issue                 → 신분증 자동 발급 ("관객N", 더미 주민번호)
 *   관객 폰      POST /api/session {merchantId}  → 새 nonce 가 든 제시 요청
 *   관객 폰      POST /api/session/:id/vp        → 제시
 *   사장님 화면  GET  /api/merchant/:id/sessions → 들어온 제시 목록 (폴링)
 */

/** 사장님이 등록하는 요청 템플릿. 세션마다 여기에 새 nonce 가 붙는다. */
export interface MerchantTemplate {
  merchantId?: string;
  verifier: string;
  purpose: string;
  requested: string[];
}

export interface MerchantRecord extends MerchantTemplate {
  merchantId: string;
}

export interface MerchantRegistered {
  merchantId: string;
}

export interface IssuerInfo {
  did: string;
  /**
   * 발급 형식 버전. 서버가 발급 내용(이름 규칙 등)을 바꾸면 올린다.
   * 지갑은 저장된 신분증의 버전이 다르면 다시 발급받는다.
   */
  version: number;
}

export interface IssueRequest {
  holderPublicJwk: JWK;
}

export interface IssueResponse {
  credential: SdJwtCompact;
  /** 이름 풀에서 배정된 이름 — 실제 개인정보는 받지 않는다. */
  name: string;
  issuerDid: string;
  version: number;
}

export interface SessionCreateRequest {
  merchantId: string;
}

export interface SessionCreated {
  sessionId: string;
  request: PresentationRequest;
}

/** 세션 하나 = 제시 한 건. sessionId 단위로 완전히 격리된다. */
export interface SessionRecord {
  sessionId: string;
  merchantId: string;
  request: PresentationRequest;
  vp?: SdJwtCompact;
  createdAt: number;
  presentedAt?: number;
}

export interface MerchantSessions {
  sessions: SessionRecord[];
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* 본문이 JSON 이 아니면 상태 코드만 보여준다 */
    }
    throw new Error(detail || `${init?.method ?? 'GET'} ${path} → ${res.status}`);
  }
  return (await res.json()) as T;
}

// ────────────────────────────────────────────────────────────────────
// 역할별 API 응답 (server/roleRoutes.ts). 역할 페이지들이 요약을 그릴 때 쓴다.
// ────────────────────────────────────────────────────────────────────

export interface CredentialView {
  issuerDid?: string;
  expiresAt?: number;
  selective: Record<string, { value: unknown; salt: string; digest: string }>;
  sealed: Record<string, { algorithm: string; encryption: string; audience?: string }>;
  plaintext: Record<string, unknown>;
}

export interface IssuerIssueResponse {
  input: { name: string; birthDate: string; address: string; rrn: string };
  issuerDid: string;
  holderId: string | null;
  plaintextRrnInCredential: boolean;
  credential: CredentialView;
}

export interface HolderViewResponse {
  did: string;
  privateKey: string;
  credentials: (CredentialView & { id: string })[];
}

export interface HolderPresentResponse {
  sessionId: string;
  request: { verifier: string; purpose: string; nonce: string };
  sent: {
    shown: { key: string; label: string; value: unknown }[];
    sealed: { key: string; label: string }[];
    withheld: { key: string; label: string }[];
  };
  presentation: { disclosures: number; keyBindingJwt: { nonce: string; aud: string } | null };
}

export interface VerifierResponse {
  ok: boolean;
  summary: { label: string; ok: boolean; detail?: string }[];
  sees: {
    disclosed: { key: string; value: unknown }[];
    sealed: Record<string, { algorithm: string }>;
    withheldDigests: string[];
  };
  requestSatisfied: { satisfied: boolean; received: string[]; missing: string[] } | null;
}

export interface VerifierOpenResponse {
  opened: boolean;
  attempts: { key: string; ok: boolean; error?: string }[];
}

export interface TaxUnsealResponse {
  rrn: string;
  seal: { algorithm: string; encryption: string; audience?: string };
  statement: Record<string, unknown>;
}
