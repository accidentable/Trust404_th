import type { VerificationCheck } from '../shared/types';

/**
 * 검증 결과 4줄 (§10). 내부 검사 11개를 묶는다.
 * 한 줄이 실패하면 그 안에서 실패한 검사의 설명을 붙인다.
 * 사장님 화면과 역할 API(/api/verifier) 가 같은 묶음을 쓴다.
 */
const CHECK_GROUPS: { label: string; ids: string[] }[] = [
  { label: '주민센터 서명 확인', ids: ['issuer-trusted', 'issuer-signature', 'credential-type', 'disclosure-digests', 'library-crosscheck'] },
  { label: '유효기간 정상', ids: ['validity'] },
  { label: '본인 제시 확인', ids: ['kb-signature', 'kb-nonce', 'kb-audience', 'kb-sd-hash'] },
  { label: '폐기 여부 확인', ids: ['revocation'] },
];

export interface CheckGroup {
  label: string;
  ok: boolean;
  detail?: string;
}

export function groupChecks(checks: VerificationCheck[]): CheckGroup[] {
  return CHECK_GROUPS.map((group) => {
    const members = checks.filter((check) => group.ids.includes(check.id));
    const failed = members.find((check) => !check.ok);
    return { label: group.label, ok: members.length > 0 && !failed, ...(failed ? { detail: failed.detail } : {}) };
  });
}
