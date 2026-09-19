/**
 * Phase 3 — Holder Binding
 * 완료 조건: 남의 VP 재사용이 거부됨
 *
 * 테스트 3개
 *   1. 정상 제시                          → 통과
 *   2. 다른 nonce 로 만든 VP 를 재사용       → 거부 (nonce 불일치)
 *   3. 다른 키로 서명한 KB-JWT              → 거부 (cnf 불일치)
 *
 * 아직 없는 것: UI(Phase 5) · 폐기(Phase 6) · 계좌 VC(Phase 7)
 */
import { ResidentCenterIssuer } from '../src/issuer/residentCenter';
import { HolderWallet } from '../src/holder/wallet';
import { EmployerVerifier } from '../src/verifier/employer';
import { NationalTaxService } from '../src/tax/nationalTaxService';
import { createPresentationRequest } from '../src/verifier/request';
import { splitPresentation, decodeJwtHeader, decodeJwtPayload } from '../src/verifier/disclosureAudit';
import { VCT_RESIDENT_ID } from '../src/shared/schema';
import type { VerificationReport } from '../src/shared/types';

const LINE = '─'.repeat(74);

function step(label: string, title: string): void {
  console.log(`\n${LINE}\n[${label}] ${title}\n${LINE}`);
}

function printChecks(report: VerificationReport): void {
  for (const check of report.checks) {
    console.log(`    ${check.ok ? '✅' : '❌'} ${check.label.padEnd(20, ' ')} ${check.detail}`);
  }
  console.log(`    ${report.ok ? '→ 검증 통과' : '→ 검증 거부'}`);
}

async function main(): Promise<void> {
  console.log('TRUST404 트랙 02 — Phase 3: Holder Binding');

  const residentCenter = new ResidentCenterIssuer();
  const alice = new HolderWallet(); // VC 의 진짜 주인
  const mallory = new HolderWallet(); // 공격자 — 자기 키쌍을 갖고 있다

  const employer = new EmployerVerifier(); // 사장님 (행사운영팀)
  const otherVerifier = new EmployerVerifier(); // 다른 검증자 (PC방 알바)
  const nts = new NationalTaxService(); // 국세청 (봉인 수신자)

  // ────────────────────────────────────────────────────────────────
  step('준비', 'cnf — 발급 시점에 홀더 공개키를 VC 에 박는다');

  const issued = await residentCenter.issueResidentId(
    {
      name: '윤태호',
      address: '서울특별시 성북구 안암로 145',
      birthDate: '2001-03-14',
      rrn: '010314-3000000',
    },
    { holderPublicJwk: alice.publicJwk, taxAuthorityPublicJwk: nts.publicJwk },
  );
  const stored = await alice.save(issued.credential);

  const vcPayload = decodeJwtPayload(splitPresentation(issued.credential).jwt);
  console.log('  VC 본체의 cnf (발급자가 서명한 평문 필드):');
  console.log(`    ${JSON.stringify(vcPayload.cnf)}`);
  console.log(`\n  홀더(진짜 주인)  ${alice.did}`);
  console.log(`  공격자           ${mallory.did}`);
  console.log('  → cnf 에 박힌 키는 홀더 것이다. 공격자 키가 아니다.');

  // ════════════════════════════════════════════════════════════════
  step('테스트 1', '정상 제시 — 홀더가 사장님의 nonce 에 서명한다');
  // ════════════════════════════════════════════════════════════════

  const requestA = createPresentationRequest({
    verifier: '행사운영팀',
    purpose: '일당 지급 및 원천징수 신고',
    requested: ['name', 'isOver18'],
  });
  console.log(`  요청 nonce       ${requestA.nonce}`);
  console.log(`  요청 verifier    ${requestA.verifier}`);

  const planA = alice.reviewRequest(stored.id, requestA);
  const vpA = await alice.presentPlan(stored.id, planA);

  const partsA = splitPresentation(vpA);
  console.log(`\n  응답 포맷 (§7)   <본체 JWT>~<조각: name>~<조각: isOver18>~<KB-JWT>`);
  console.log(`  KB-JWT header    ${JSON.stringify(decodeJwtHeader(partsA.keyBindingJwt as string))}`);
  console.log(`  KB-JWT payload   ${JSON.stringify(decodeJwtPayload(partsA.keyBindingJwt as string))}`);
  console.log('                   ↑ 홀더 개인키로 서명됨. sd_hash 가 조각 구성까지 묶는다.');

  console.log('\n  사장님 검증:');
  const reportA = await employer.verify(vpA, {
    trustedIssuers: [residentCenter.did],
    expectedVct: VCT_RESIDENT_ID,
    request: requestA,
  });
  printChecks(reportA);

  // ════════════════════════════════════════════════════════════════
  step('테스트 2', '재사용 — 사장님이 받은 VP 를 다른 검증자에게 그대로 제출');
  // ════════════════════════════════════════════════════════════════

  const requestB = createPresentationRequest({
    verifier: 'PC방 알바',
    purpose: '근로계약 체결',
    requested: ['name', 'isOver18'],
  });

  console.log('  다른 검증자가 새로 만든 요청:');
  console.log(`    nonce          ${requestB.nonce}   (행사운영팀의 ${requestA.nonce} 와 다름)`);
  console.log(`    verifier       ${requestB.verifier}`);
  console.log('\n  공격: 사장님이 받아 둔 VP 를 한 글자도 안 고치고 그대로 붙여넣는다.');
  console.log(`    재사용하는 VP  ${vpA.slice(0, 48)}… (테스트 1 과 동일)`);

  console.log('\n  다른 검증자 검증:');
  const reportB = await otherVerifier.verify(vpA, {
    trustedIssuers: [residentCenter.did],
    expectedVct: VCT_RESIDENT_ID,
    request: requestB,
  });
  printChecks(reportB);
  console.log(
    '\n    발급자 서명도 조각 해시도 멀쩡하다 — VC 자체는 진짜다.',
  );
  console.log('    걸린 지점은 "이 제시가 나에게 온 것인가" 뿐이다.');

  // ════════════════════════════════════════════════════════════════
  step('테스트 3', 'cnf 불일치 — 공격자가 훔친 VC 에 자기 키로 KB-JWT 를 붙인다');
  // ════════════════════════════════════════════════════════════════

  // 공격자가 VC 원본을 통째로 훔쳤다고 가정한다 (지갑 유출, 백업 탈취 등).
  const stolen = await mallory.save(issued.credential);
  console.log('  공격자가 VC 원본을 통째로 확보했다고 가정한다.');
  console.log(`    훔친 VC 의 cnf  ${JSON.stringify(vcPayload.cnf)}`);
  console.log(`    공격자 공개키    ${JSON.stringify(mallory.publicJwk)}`);

  const requestC = createPresentationRequest({
    verifier: '행사운영팀',
    purpose: '일당 지급 및 원천징수 신고',
    requested: ['name', 'isOver18'],
  });

  // 공격자는 사장님이 방금 준 nonce·aud 를 정확히 넣는다. 그래도 서명 키가 자기 것이다.
  const planC = mallory.reviewRequest(stolen.id, requestC);
  const vpC = await mallory.presentPlan(stolen.id, planC);

  const kbC = decodeJwtPayload(splitPresentation(vpC).keyBindingJwt as string);
  console.log(`\n  공격자가 만든 KB-JWT payload:`);
  console.log(`    ${JSON.stringify(kbC)}`);
  console.log(`    nonce 와 aud 는 정확하다 (${requestC.nonce}, ${requestC.verifier}).`);
  console.log('    서명만 공격자 개인키로 되어 있다.');

  console.log('\n  사장님 검증:');
  const reportC = await employer.verify(vpC, {
    trustedIssuers: [residentCenter.did],
    expectedVct: VCT_RESIDENT_ID,
    request: requestC,
  });
  printChecks(reportC);
  console.log('\n    nonce·aud 는 통과했다. cnf 공개키로 서명이 안 풀려서 걸렸다.');

  // ════════════════════════════════════════════════════════════════
  step('요약', '테스트 3개 결과');
  // ════════════════════════════════════════════════════════════════

  const rows: [string, boolean, string, string][] = [
    ['정상 제시', reportA.ok, '통과', failedCheckIds(reportA)],
    ['다른 nonce 로 만든 VP 재사용', !reportB.ok, '거부', failedCheckIds(reportB)],
    ['다른 키로 서명한 KB-JWT', !reportC.ok, '거부', failedCheckIds(reportC)],
  ];

  console.log('  시나리오                          기대   결과   걸린 검사');
  console.log(`  ${'─'.repeat(70)}`);
  for (const [label, asExpected, expected, failed] of rows) {
    console.log(
      `  ${label.padEnd(32, ' ')}${expected.padEnd(7, ' ')}${(asExpected ? '✅ 일치' : '❌ 불일치').padEnd(9, ' ')}${failed}`,
    );
  }

  // 재사용이 nonce 때문에 막혔는지, cnf 불일치가 서명 때문에 막혔는지 정확히 짚는다.
  const reuseBlockedByNonce = isFailed(reportB, 'kb-nonce');
  const forgeryBlockedBySignature = isFailed(reportC, 'kb-signature');
  const forgeryNoncePassed = !isFailed(reportC, 'kb-nonce');

  console.log('\n  거부 사유가 의도한 것과 같은지:');
  console.log(`    재사용이 nonce 불일치로 막혔는가        ${mark(reuseBlockedByNonce)}`);
  console.log(`    위조가 cnf 서명 불일치로 막혔는가        ${mark(forgeryBlockedBySignature)}`);
  console.log(`    위조 건에서 nonce 는 통과했는가          ${mark(forgeryNoncePassed)} (= cnf 가 잡아낸 것)`);

  // ────────────────────────────────────────────────────────────────
  const passed =
    reportA.ok &&
    !reportB.ok &&
    !reportC.ok &&
    reuseBlockedByNonce &&
    forgeryBlockedBySignature &&
    forgeryNoncePassed;

  console.log(`\n${LINE}`);
  console.log(
    passed
      ? 'PHASE 3 완료 — 정상 제시 통과, 남의 VP 재사용과 키 위조 모두 의도한 사유로 거부'
      : 'PHASE 3 실패 — 위 결과를 확인하세요',
  );
  console.log(LINE);

  console.log('\n  한계 (§12 — 탐지 못 하는 것):');
  console.log('    · aud 는 요청의 `verifier` 문자열이다. 검증자의 암호학적 신원이 아니라서');
  console.log('      중계 공격(검증자와 제3자가 실시간으로 nonce 를 넘겨받는 경우)은 막지 못한다.');
  console.log('      완화하려면 aud 를 검증자 DID 로 바꾸고 요청 자체에 서명해야 한다.');
  console.log('    · 사장님이 알게 된 "이름"을 메모하는 것은 기술로 막지 못한다.');

  if (!passed) process.exitCode = 1;
}

function isFailed(report: VerificationReport, checkId: string): boolean {
  return report.checks.some((check) => check.id === checkId && !check.ok);
}

function failedCheckIds(report: VerificationReport): string {
  const failed = report.checks.filter((check) => !check.ok).map((check) => check.id);
  return failed.length === 0 ? '(없음)' : failed.join(', ');
}

function mark(value: boolean): string {
  return value ? '✅' : '❌';
}

main().catch((error: unknown) => {
  console.error('\n실행 중 오류:', error);
  process.exitCode = 1;
});
