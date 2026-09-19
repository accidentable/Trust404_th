/**
 * Phase 2 — 선택적 공개
 * 완료 조건: 조각 일부만 보내도 검증 통과
 *
 * 확인할 것
 *   1. §7 요청/응답 포맷대로 주고받는다
 *   2. 요청의 `requested` 를 읽어 승인 화면을 동적으로 만든다 (하드코딩 없음)
 *   3. 안 보낸 항목은 검증자 쪽에 **해시로만** 남는다 — 값도 이름도 알 수 없다
 *
 * 아직 없는 것: KB-JWT(Phase 3 에서 붙는다) · 폐기(Phase 6) · 계좌 VC(Phase 7)
 */
import { ResidentCenterIssuer } from '../src/issuer/residentCenter';
import { HolderWallet } from '../src/holder/wallet';
import { EmployerVerifier } from '../src/verifier/employer';
import { NationalTaxService } from '../src/tax/nationalTaxService';
import { createPresentationRequest } from '../src/verifier/request';
import { splitPresentation } from '../src/verifier/disclosureAudit';
import { VCT_RESIDENT_ID } from '../src/shared/schema';
import { decodeSdJwt } from '@sd-jwt/core';
import { hasher, sha256Base64Url } from '../src/shared/crypto';
import type { ApprovalPlan } from '../src/shared/types';

const LINE = '─'.repeat(74);

function step(n: string, title: string): void {
  console.log(`\n${LINE}\n[${n}] ${title}\n${LINE}`);
}

async function main(): Promise<void> {
  console.log('TRUST404 트랙 02 — Phase 2: 선택적 공개');

  const residentCenter = new ResidentCenterIssuer();
  const wallet = new HolderWallet();
  const employer = new EmployerVerifier();
  const nts = new NationalTaxService();

  const issued = await residentCenter.issueResidentId(
    {
      name: '윤태호',
      address: '서울특별시 성북구 안암로 145',
      birthDate: '2001-03-14',
      rrn: '010314-3000000',
    },
    { holderPublicJwk: wallet.publicJwk, taxAuthorityPublicJwk: nts.publicJwk },
  );
  const stored = await wallet.save(issued.credential);

  step('0', '지갑이 가진 것 — 발급받은 신분 VC 전체');
  console.log(`  vct              ${stored.vct}`);
  for (const [key, value] of Object.entries(stored.selectiveClaims)) {
    console.log(`    조각  ${key.padEnd(11, ' ')} ${JSON.stringify(value)}`);
  }
  console.log(`    평문  statusIndex ${stored.statusIndex}`);
  console.log(`  봉인 필드          ${stored.sealedClaims.join(', ') || '(없음)'}  (국세청 공개키로 봉인됨)`);

  // ══════════════════════════════════════════════════════════════════
  // 시나리오 A — §7 예시 요청을 그대로
  // ══════════════════════════════════════════════════════════════════
  step('A-1', '요청 — 사장님이 보낸다 (§7 포맷)');

  const requestA = createPresentationRequest({
    verifier: '행사운영팀',
    purpose: '일당 지급 및 원천징수 신고',
    // §7 의 예시 요청 그대로. accountHolderName 은 계좌 VC(Phase 7) 항목이다.
    requested: ['name', 'isOver18', 'rrn_sealed', 'accountHolderName'],
  });
  console.log(indent(JSON.stringify(requestA, null, 2), 2));

  step('A-2', '승인 화면 — 요청에서 동적으로 생성 (지갑)');

  const planA = wallet.reviewRequest(stored.id, requestA);
  printApprovalScreen(planA);

  step('A-3', '제시 — 승인한 조각만 붙인다');

  // Phase 2 시점 재현 — KB-JWT 없이 조각만 붙인다. (Holder Binding 은 Phase 3)
  const vpA = await wallet.present(stored.id, planA.disclose);
  printPresentationShape(vpA, planA);

  step('A-4', '검증 — 사장님');

  const reportA = await employer.verify(vpA, {
    trustedIssuers: [residentCenter.did],
    expectedVct: VCT_RESIDENT_ID,
    request: requestA,
    requireKeyBinding: false,
  });
  printChecks(reportA.checks);
  printAudit(reportA);

  // ══════════════════════════════════════════════════════════════════
  // 시나리오 B — 같은 VC, 다른 요청. 사장님이 주소까지 요구한다
  // ══════════════════════════════════════════════════════════════════
  step('B-1', '요청이 바뀌면 승인 화면도 바뀐다 — 주소를 추가로 요구');

  const requestB = createPresentationRequest({
    verifier: '행사운영팀',
    purpose: '일당 지급 및 원천징수 신고',
    requested: ['name', 'isOver18', 'address', 'birthDate'],
  });
  console.log(`  requested        ${requestB.requested.join(', ')}`);

  const planBAsRequested = wallet.reviewRequest(stored.id, requestB);
  console.log('\n  요청대로라면 지갑 화면은 이렇게 된다 (하드코딩이 아니라 요청에서 나온 목록):');
  printApprovalScreen(planBAsRequested, 2);

  step('B-2', '홀더가 주소·생년월일을 거부하고 제시');

  const planB = wallet.reviewRequest(stored.id, requestB, { deny: ['address', 'birthDate'] });
  printApprovalScreen(planB);

  const vpB = await wallet.present(stored.id, planB.disclose);
  printPresentationShape(vpB, planB);

  step('B-3', '검증 — 조각 2개만 왔는데도 통과하는가');

  const reportB = await employer.verify(vpB, {
    trustedIssuers: [residentCenter.did],
    expectedVct: VCT_RESIDENT_ID,
    request: requestB,
    requireKeyBinding: false,
  });
  printChecks(reportB.checks);
  printAudit(reportB);

  console.log('\n  요청 충족 여부 (암호 검증과 별개)');
  console.log(`    받은 항목        ${reportB.request?.received.join(', ') || '(없음)'}`);
  console.log(`    못 받은 항목      ${reportB.request?.missing.join(', ') || '(없음)'}`);
  console.log('    → VC 는 유효하다. 주소가 없는 건 홀더가 거부한 것이고,');
  console.log('      그걸 받아들일지는 사장님의 정책 판단이다.');

  // ══════════════════════════════════════════════════════════════════
  step('C', '증거 — 안 보낸 항목이 검증자 쪽에 어떻게 남아 있는가');
  // ══════════════════════════════════════════════════════════════════

  const { jwt } = splitPresentation(vpB);
  const rawPayload = JSON.parse(
    Buffer.from(jwt.split('.')[1] as string, 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

  console.log('  사장님이 받은 본체 JWT 의 payload 원문 — 이게 전부다:\n');
  console.log(indent(JSON.stringify(rawPayload, null, 2), 4));

  console.log('\n  `_sd` 배열에는 다이제스트 4개가 있는데 조각은 2개만 왔다.');
  console.log('  나머지 2개에 대해 사장님이 아는 것:');
  console.log('    · 그런 항목이 2개 있다는 사실');
  console.log('    · 각각의 SHA-256 다이제스트');
  console.log('  모르는 것:');
  console.log('    · 항목의 **이름** (address 인지 birthDate 인지 다른 무엇인지)');
  console.log('    · 항목의 **값**');
  console.log('    · salt 가 128비트 난수라 대입으로도 못 맞힌다 —');
  console.log('      isOver18 처럼 값이 true/false 둘뿐인 항목도 마찬가지다. (§8-1)');

  // 지갑은 salt 를 갖고 있으므로 어느 다이제스트가 어느 항목인지 계산할 수 있다.
  // 사장님은 salt 가 없어서 같은 계산을 할 수 없다 — 그게 선택적 공개의 전부다.
  const digestsByClaim = await computeDigestsByClaim(stored.credential);
  console.log('\n  지갑은 salt 를 아니까 어느 해시가 무엇인지 계산할 수 있다:');
  for (const digest of reportB.audit.withheldDigests) {
    const key = digestsByClaim.get(digest) ?? '';
    console.log(`    ${digest}`);
    console.log(`      └─ 지갑이 아는 정답: ${key} = ${JSON.stringify(stored.selectiveClaims[key])}`);
  }
  console.log('\n    사장님은 이 "정답" 줄을 만들 방법이 없다. salt 없이는 해시를 되돌릴 수도,');
  console.log('    후보값을 대입해 맞혀 볼 수도 없다.');

  // ══════════════════════════════════════════════════════════════════
  const passed =
    reportA.ok &&
    reportB.ok &&
    reportB.audit.disclosed.length === 2 &&
    reportB.audit.withheldDigests.length === 2 &&
    reportA.audit.disclosed.length === 2 &&
    reportA.audit.withheldDigests.length === 2;

  console.log(`\n${LINE}`);
  console.log(
    passed
      ? 'PHASE 2 완료 — 조각 일부(2/4)만 보낸 VP 가 검증 통과, 나머지 2개는 해시로만 남음'
      : 'PHASE 2 실패 — 위 결과를 확인하세요',
  );
  console.log(LINE);

  if (!passed) process.exitCode = 1;
}

// ────────────────────────────────────────────────────────────────────
// 출력 헬퍼
// ────────────────────────────────────────────────────────────────────

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => pad + line)
    .join('\n');
}

/** §10 지갑 승인 화면 — 3칸 구분이 이 프로젝트의 얼굴이다. */
function printApprovalScreen(plan: ApprovalPlan, extra = 0): void {
  const pad = ' '.repeat(2 + extra);
  console.log(`${pad}${plan.verifier}`);
  console.log(`${pad}${plan.purpose}`);
  console.log(`${pad}${'─'.repeat(44)}`);

  console.log(`${pad}보여줄 정보`);
  if (plan.shown.length === 0) console.log(`${pad}  (없음)`);
  for (const item of plan.shown) {
    console.log(`${pad}  ✓ ${item.label} · ${formatValue(item.value)}`);
  }

  console.log(`\n${pad}잠긴 채 전달 (상대는 열 수 없음)`);
  if (plan.sealed.length === 0) console.log(`${pad}  (없음)`);
  for (const item of plan.sealed) {
    console.log(`${pad}  🔒 ${item.label}${item.note ? ` — ${item.note}` : ''}`);
  }

  console.log(`\n${pad}보내지 않음`);
  if (plan.withheld.length === 0) console.log(`${pad}  (없음)`);
  for (const item of plan.withheld) {
    console.log(`${pad}  ✗ ${item.label}${item.note ? ` (${item.note})` : ''}`);
  }

  if (plan.unavailable.length > 0) {
    console.log(`\n${pad}요청받았지만 지갑에 없음`);
    for (const item of plan.unavailable) {
      console.log(`${pad}  · ${item.label}${item.note ? ` — ${item.note}` : ''}`);
    }
  }

  console.log(`${pad}${'─'.repeat(44)}`);
  console.log(`${pad}[거부]  [제시하기]   → 보낼 조각: ${plan.disclose.join(', ') || '(없음)'}`);
}

function printPresentationShape(vp: string, plan: ApprovalPlan): void {
  const parts = splitPresentation(vp);
  console.log(`  응답 포맷 (§7)   <본체 JWT>~${plan.disclose.map((k) => `<조각: ${k}>`).join('~')}~`);
  console.log(`  조각 수          ${parts.disclosures.length}개`);
  console.log(`  KB-JWT           ${parts.keyBindingJwt ? '있음' : '없음 (Phase 3)'}`);
  console.log(`  길이             ${vp.length}자`);
}

function printChecks(checks: readonly { ok: boolean; label: string; detail: string }[]): void {
  for (const check of checks) {
    console.log(`  ${check.ok ? '✅' : '❌'} ${check.label.padEnd(20, ' ')} ${check.detail}`);
  }
}

function printAudit(report: { audit: { disclosed: { key: string; value: unknown }[]; withheldDigests: string[]; alwaysPresent: Record<string, unknown> } }): void {
  console.log('\n  검증자가 실제로 본 것');
  for (const claim of report.audit.disclosed) {
    console.log(`    ✓ ${claim.key.padEnd(11, ' ')} ${JSON.stringify(claim.value)}`);
  }
  for (const [key, value] of Object.entries(report.audit.alwaysPresent)) {
    console.log(`    · ${key.padEnd(11, ' ')} ${JSON.stringify(value)}  (평문 필드)`);
  }
  console.log('\n  검증자에게 해시로만 남은 것');
  if (report.audit.withheldDigests.length === 0) {
    console.log('    (없음)');
  }
  for (const digest of report.audit.withheldDigests) {
    console.log(`    ✗ ??? = ???   digest=${digest}`);
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return String(value);
}

/** 지갑이 가진 원본 VC 에서 조각별 다이제스트를 계산한다 (salt 를 알아야 가능하다). */
async function computeDigestsByClaim(credential: string): Promise<Map<string, string>> {
  const decoded = await decodeSdJwt(credential, hasher);
  const map = new Map<string, string>();
  for (const disclosure of decoded.disclosures) {
    if (disclosure.key === undefined) continue;
    map.set(sha256Base64Url(disclosure.encode()), disclosure.key);
  }
  return map;
}

main().catch((error: unknown) => {
  console.error('\n실행 중 오류:', error);
  process.exitCode = 1;
});
