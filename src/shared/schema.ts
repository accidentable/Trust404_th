/**
 * VC 스키마 상수 (§7 데이터 모델)
 *
 * 신분 VC 는 두 종류의 필드로 나뉜다.
 *  - 선택적 공개(_sd): 조각으로 쪼개져 해시만 본체에 들어간다. 안 보내면 존재만 남는다.
 *  - 항상 포함(평문): 본체에 그대로 들어간다.
 */
export const VCT_RESIDENT_ID = 'https://trust404.demo/credentials/resident-id';

/** 홀더가 항목 단위로 공개 여부를 고를 수 있는 항목들. */
export const RESIDENT_ID_SELECTIVE_CLAIMS = ['name', 'address', 'isOver18', 'birthDate'] as const;
export type ResidentIdSelectiveClaim = (typeof RESIDENT_ID_SELECTIVE_CLAIMS)[number];

/**
 * 골라낼 수 없이 항상 따라가는 평문 필드들.
 * `rrn_sealed`(국세청 공개키로 봉인한 주민등록번호)는 Phase 4 에서 추가된다.
 */
export const RESIDENT_ID_ALWAYS_PRESENT_CLAIMS = ['statusIndex'] as const;

/** 표준 JWT/SD-JWT-VC 클레임. 라이브러리가 선택적 공개를 막는 보호 필드이기도 하다. */
export const PROTECTED_CLAIMS = ['iss', 'iat', 'nbf', 'exp', 'vct', 'cnf', 'status'] as const;

/** 시연용 만료: 발급 후 1시간. 공격 시연(§12)의 "만료" 케이스에서 음수로 뒤집어 쓴다. */
export const RESIDENT_ID_TTL_SECONDS = 60 * 60;

export const SD_JWT_TYP = 'dc+sd-jwt' as const;

export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ────────────────────────────────────────────────────────────────────
// 클레임 카탈로그 (Phase 2: 선택적 공개)
//
// 지갑 승인 화면은 이 표를 보고 **요청받은 항목만** 동적으로 그린다.
// 화면에 항목을 하드코딩하면 사장님이 요청을 바꿔도 지갑 화면이 그대로여서
// 심사위원이 확인할 수 없다. (§7)
// ────────────────────────────────────────────────────────────────────

/**
 * - `selective`: 조각으로 쪼개져 있다. 홀더가 보낼지 말지 고른다.
 * - `sealed`   : 항상 따라가지만 검증자는 열 수 없다. (Phase 4 의 rrn_sealed)
 * - `always`   : 항상 평문으로 따라간다. (statusIndex)
 */
export type ClaimDisclosureMode = 'selective' | 'sealed' | 'always';

export interface ClaimDescriptor {
  label: string;
  mode: ClaimDisclosureMode;
  /** 이 항목이 들어 있는 credential 의 vct. */
  vct: string;
  note?: string;
}

export const VCT_BANK_ACCOUNT = 'https://trust404.demo/credentials/bank-account';

export const CLAIM_CATALOG: Record<string, ClaimDescriptor> = {
  name: { label: '성명', mode: 'selective', vct: VCT_RESIDENT_ID },
  address: { label: '주소', mode: 'selective', vct: VCT_RESIDENT_ID },
  isOver18: { label: '만 18세 이상', mode: 'selective', vct: VCT_RESIDENT_ID },
  birthDate: { label: '생년월일', mode: 'selective', vct: VCT_RESIDENT_ID },
  rrn_sealed: {
    label: '주민등록번호',
    mode: 'sealed',
    vct: VCT_RESIDENT_ID,
    note: '국세청만 열 수 있음',
  },
  statusIndex: { label: '폐기 확인 인덱스', mode: 'always', vct: VCT_RESIDENT_ID },
  // 계좌 VC (Phase 7). 라벨만 먼저 둔다: §7 예시 요청을 그대로 실행해 보기 위해서다.
  accountHolderName: { label: '예금주', mode: 'selective', vct: VCT_BANK_ACCOUNT },
  bankName: { label: '은행', mode: 'selective', vct: VCT_BANK_ACCOUNT },
  last4: { label: '계좌 뒷 4자리', mode: 'selective', vct: VCT_BANK_ACCOUNT },
};

export function describeClaim(key: string): ClaimDescriptor {
  return (
    CLAIM_CATALOG[key] ?? {
      label: key,
      mode: 'selective',
      vct: '(알 수 없음)',
      note: '카탈로그에 없는 항목',
    }
  );
}

// ────────────────────────────────────────────────────────────────────
// 제시 요청 옵션: 사장님 화면이 고르고, 알바생 지갑이 과잉 요청 경고에 쓴다.
// ────────────────────────────────────────────────────────────────────

/**
 * 사례 목록: 사장님 화면에서 고른다. `required` 가 그 용도에 실제로 필요한 항목이고,
 * 그보다 더 요청하면 알바생 지갑에 과잉 요청 경고가 뜬다.
 *
 * 주소·생년월일이 **정당하게** 필요한 사례를 일부러 넣었다.
 * "항상 최소만"이 아니라 "용도에 맞는 만큼만"이 이 프로젝트의 주장이다.
 */
export interface PurposeCase {
  id: string;
  verifier: string;
  purpose: string;
  required: readonly string[];
  /** 왜 그 항목이 필요한지: 사장님 화면에 한 줄로 보여준다. */
  why: string;
}

export const PURPOSE_CASES: readonly PurposeCase[] = [
  {
    id: 'daily-wage',
    verifier: '행사운영팀',
    purpose: '일당 지급 및 원천징수 신고',
    required: ['name', 'isOver18', 'rrn_sealed'],
    why: '지급명세서에 주민번호가 들어가지만 그건 국세청 몫입니다. 사장님은 성명과 연소자 여부만',
  },
  {
    id: 'prize',
    verifier: '학생회',
    purpose: '공모전 상금 지급 (기타소득 신고)',
    required: ['name', 'rrn_sealed'],
    why: '상금은 나이 제한이 없다. 성명과 봉인된 주민번호면 충분',
  },
  {
    id: 'public-work',
    verifier: '구청 일자리센터',
    purpose: '지역 주민 공공근로 채용 (거주지 요건)',
    required: ['name', 'isOver18', 'address', 'rrn_sealed'],
    why: '관내 거주자만 채용할 수 있어 주소가 실제로 필요한 경우',
  },
  {
    id: 'liquor',
    verifier: '주점 사장님',
    purpose: '주류 취급 알바 채용 (만 19세 확인)',
    required: ['name', 'birthDate', 'rrn_sealed'],
    why: '청소년보호법은 만 19세 기준이라 신분증의 "만 18세 이상"으로는 부족해 생년월일이 필요',
  },
  {
    id: 'interview',
    verifier: '카페 사장님',
    purpose: '단기 알바 면접 (신원 확인만)',
    required: ['name', 'isOver18'],
    why: '아직 지급 전이라 주민번호도 필요 없다',
  },
];

export const DEFAULT_CASE: PurposeCase = PURPOSE_CASES[0] as PurposeCase;
export const DEFAULT_PURPOSE = DEFAULT_CASE.purpose;
export const DEFAULT_REQUESTED: readonly string[] = DEFAULT_CASE.required;

/** 요청의 purpose 로 필요 항목을 찾는다. 모르는 용도면 빈 배열: 경고를 내지 않는다. */
export function requiredClaimsFor(purpose: string): readonly string[] {
  return PURPOSE_CASES.find((item) => item.purpose === purpose)?.required ?? [];
}

/** 사장님이 체크할 수 있는 항목. 화면은 이 배열을 읽어 그린다. */
export const REQUESTABLE_CLAIMS = ['name', 'isOver18', 'rrn_sealed', 'address', 'birthDate'] as const;
