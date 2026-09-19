/**
 * Phase 4 — 봉인 (프로젝트의 핵심)
 * 완료 조건: 사장님은 복호화 실패, 국세청은 성공
 *
 * 테스트
 *   1. 발급 — 주민번호가 봉인되어 들어가고, 평문으로는 어디에도 남지 않는다
 *   2. 사장님 [열기] — 자기 키로도, 국세청 **공개**키로도 실패
 *   3. 봉인 탈취 (§12) — 봉인만 빼내 다른 곳에서 열기 시도 → 실패
 *   4. 봉인 변조 — 한 글자만 바꿔도 국세청조차 못 연다 (AEAD 무결성)
 *   5. 국세청 [열기] — 성공. 원문과 일치
 *
 * 아직 없는 것: UI(Phase 5) · 폐기(Phase 6) · 계좌 VC(Phase 7)
 */
import { ResidentCenterIssuer } from '../src/issuer/residentCenter';
import { HolderWallet } from '../src/holder/wallet';
import { EmployerVerifier } from '../src/verifier/employer';
import { NationalTaxService } from '../src/tax/nationalTaxService';
import { createPresentationRequest } from '../src/verifier/request';
import { describeSeal, unseal } from '../src/shared/sealing';
import { generateX25519KeyPair, privateJwkFromX25519 } from '../src/shared/keys';
import { VCT_RESIDENT_ID } from '../src/shared/schema';
import type { SealOpenAttempt } from '../src/verifier/employer';

const LINE = '─'.repeat(74);
const RRN = '010314-3000000';

function step(label: string, title: string): void {
  console.log(`\n${LINE}\n[${label}] ${title}\n${LINE}`);
}

function printAttempts(attempts: readonly SealOpenAttempt[]): void {
  for (const attempt of attempts) {
    console.log(`    ${attempt.ok ? '🔓 열림' : '❌ 복호화 실패'}  ${attempt.key}`);
    if (attempt.ok) console.log(`        → ${attempt.plaintext}`);
    else console.log(`        → ${attempt.error}`);
  }
}

async function main(): Promise<void> {
  console.log('TRUST404 트랙 02 — Phase 4: 봉인');

  const residentCenter = new ResidentCenterIssuer();
  const wallet = new HolderWallet();
  const employer = new EmployerVerifier();
  const nts = new NationalTaxService();

  // ════════════════════════════════════════════════════════════════
  step('1', '발급 — 주민등록번호를 국세청 공개키로 봉인한다');
  // ════════════════════════════════════════════════════════════════

  console.log(`  국세청 DID        ${nts.did}`);
  console.log(`  국세청 공개키      ${JSON.stringify(nts.publicJwk)}`);
  console.log('  → 이 공개키는 공개되어도 된다. 봉인을 만들 수만 있고 열 수는 없다.');

  const issued = await residentCenter.issueResidentId(
    {
      name: '윤태호',
      address: '서울특별시 성북구 안암로 145',
      birthDate: '2001-03-14',
      rrn: RRN,
    },
    { holderPublicJwk: wallet.publicJwk, taxAuthorityPublicJwk: nts.publicJwk },
  );
  const stored = await wallet.save(issued.credential);

  const sealInfo = describeSeal(issued.rrnSealed);
  console.log(`\n  원문 주민등록번호   ${RRN}  (주민센터 DB 에만 있던 값)`);
  console.log(`  rrn_sealed        ${issued.rrnSealed.slice(0, 56)}…`);
  console.log(`  JWE 세그먼트       ${issued.rrnSealed.split('.').length}개 (header.key.iv.ciphertext.tag)`);
  console.log('\n  봉인 겉면 — 누구 앞으로 된 것인지만 읽힌다 (§8-2):');
  console.log(`    alg             ${sealInfo.algorithm}`);
  console.log(`    enc             ${sealInfo.encryption}`);
  console.log(`    aud             ${sealInfo.audience}`);
  console.log(`    cty             ${sealInfo.purpose}`);
  console.log(`    epk             ${sealInfo.ephemeralPublicKey?.slice(0, 24)}…  (매 봉인마다 새로 만드는 임시 공개키)`);

  // 평문 주민번호가 VC 어디에도 남아 있지 않은지 직접 훑는다.
  const leaked = issued.credential.includes(RRN) || issued.credential.includes(RRN.replace('-', ''));
  console.log(`\n  VC 전체에서 평문 "${RRN}" 검색 → ${leaked ? '❌ 발견됨 (버그)' : '✅ 없음'}`);

  // ════════════════════════════════════════════════════════════════
  step('2', '제시 → 사장님이 받는 것');
  // ════════════════════════════════════════════════════════════════

  const request = createPresentationRequest({
    verifier: '행사운영팀',
    purpose: '일당 지급 및 원천징수 신고',
    requested: ['name', 'isOver18', 'rrn_sealed'],
  });
  const plan = wallet.reviewRequest(stored.id, request);
  const vp = await wallet.presentPlan(stored.id, plan);

  const report = await employer.verify(vp, {
    trustedIssuers: [residentCenter.did],
    expectedVct: VCT_RESIDENT_ID,
    request,
  });

  console.log(`  검증 결과          ${report.ok ? '✅ 통과' : '❌ 거부'}`);
  console.log('\n  보여줌');
  for (const claim of report.audit.disclosed) {
    console.log(`    ✓ ${claim.key.padEnd(11, ' ')} ${JSON.stringify(claim.value)}`);
  }
  console.log('\n  잠긴 채 전달 — 갖고 있지만 열 수 없다');
  for (const [key, value] of Object.entries(report.audit.sealed)) {
    console.log(`    🔒 ${key.padEnd(11, ' ')} ${value.slice(0, 44)}…`);
  }
  console.log('\n  보내지 않음 — 존재조차 모른다');
  for (const digest of report.audit.withheldDigests) {
    console.log(`    ✗ ??? = ???   digest=${digest}`);
  }

  const receivedSeal = report.audit.sealed.rrn_sealed;
  if (!receivedSeal) throw new Error('사장님이 봉인 필드를 받지 못했습니다');

  // ════════════════════════════════════════════════════════════════
  step('3', '사장님 [열기] — 실패 경로');
  // ════════════════════════════════════════════════════════════════

  console.log('  사장님이 가진 키를 전부 동원해 본다.');
  console.log('  (국세청 공개키는 웹에 공개되어 있으므로 사장님도 갖고 있다)\n');

  const employerAttempts = await employer.tryOpenSealed(receivedSeal, [nts.publicJwk]);
  printAttempts(employerAttempts);
  const employerFailed = employerAttempts.every((attempt) => !attempt.ok);
  console.log(`\n  → ${employerFailed ? '전부 실패' : '❌ 하나라도 열림 (버그)'}`);
  console.log('    공개키로는 봉인을 만들 수만 있다. 여는 건 국세청 개인키로만 된다.');

  // ════════════════════════════════════════════════════════════════
  step('4', '봉인 탈취 (§12) — 봉인만 빼내 다른 곳에서 열기');
  // ════════════════════════════════════════════════════════════════

  console.log('  공격자가 사장님 서버에서 rrn_sealed 문자열만 통째로 훔쳤다고 가정한다.');
  const attackerKey = generateX25519KeyPair();
  const stolenAttempt = await unseal(receivedSeal, privateJwkFromX25519(attackerKey));
  console.log(`    공격자 키 (X25519, 형식은 국세청 키와 동일)`);
  console.log(`    ${stolenAttempt.ok ? '🔓 열림 (버그)' : '❌ 복호화 실패'}  → ${stolenAttempt.error ?? stolenAttempt.plaintext}`);
  console.log('\n    유출되어도 열리지 않는다. 사본이 돌아다녀도 주민번호는 나오지 않는다.');

  // ════════════════════════════════════════════════════════════════
  step('5', '봉인 변조 — 한 글자만 바꾼다');
  // ════════════════════════════════════════════════════════════════

  const tampered = tamperCiphertext(receivedSeal);
  console.log('  ciphertext 세그먼트의 첫 글자를 바꿔 국세청에 제출한다.');
  const tamperedResult = await nts.unsealRrn(tampered);
  console.log(
    `    ${tamperedResult.ok ? '🔓 열림 (버그)' : '❌ 복호화 실패'}  → ${tamperedResult.error ?? tamperedResult.plaintext}`,
  );
  console.log('\n    A256GCM 은 인증 암호라서 내용이 바뀌면 태그 검증에서 걸린다.');
  console.log('    "열리기는 하는데 값이 이상함"이 아니라 아예 안 열린다.');

  // ════════════════════════════════════════════════════════════════
  step('6', '국세청 [열기] — 성공 경로');
  // ════════════════════════════════════════════════════════════════

  const ntsResult = await nts.unsealRrn(receivedSeal);
  console.log(`    ${ntsResult.ok ? '🔓 열림' : '❌ 복호화 실패'}  국세청 개인키`);
  console.log(`        → ${ntsResult.plaintext ?? ntsResult.error}`);
  const matches = ntsResult.plaintext === RRN;
  console.log(`\n  원문과 일치        ${matches ? '✅' : '❌'}  (발급 시 "${RRN}")`);

  // ════════════════════════════════════════════════════════════════
  step('7', '같은 데이터, 다른 결과 (§10 장면 B)');
  // ════════════════════════════════════════════════════════════════

  console.log('  ┌── 사장님 화면 ──────────────┐   ┌── 국세청 화면 ──────────────┐');
  console.log(`  │ 🔒 세무신고용 봉인           │   │ 🔓 ${ntsResult.plaintext}            │`);
  console.log('  │ [열기] → ❌ 복호화 실패      │   │ 지급명세서에 그대로 기재      │');
  console.log('  └─────────────────────────────┘   └─────────────────────────────┘');
  console.log(`\n  두 화면이 받은 문자열은 완전히 같다:`);
  console.log(`    ${receivedSeal.slice(0, 60)}…`);
  console.log('  다른 것은 손에 든 키뿐이다.');

  console.log('\n  "안 보내기"와 "잠가서 보내기"의 차이:');
  console.log('                 주소                  주민번호');
  console.log('    방식         조각을 안 보냄         잠가서 보냄');
  console.log('    사장님       존재도 모름            갖고 있지만 못 엶');
  console.log('    국세청       안 감                  열어서 봄');

  // ════════════════════════════════════════════════════════════════
  step('요약', '경로별 결과');
  // ════════════════════════════════════════════════════════════════

  const rows: [string, string, boolean][] = [
    ['발급 시 평문 주민번호가 VC 에 남지 않음', '없어야 함', !leaked],
    ['사장님 자기 키로 열기', '실패해야 함', !(employerAttempts[0]?.ok ?? true)],
    ['사장님이 국세청 공개키로 열기', '실패해야 함', !(employerAttempts[1]?.ok ?? true)],
    ['봉인 탈취 후 공격자 키로 열기', '실패해야 함', !stolenAttempt.ok],
    ['봉인 변조 후 국세청이 열기', '실패해야 함', !tamperedResult.ok],
    ['국세청 개인키로 열기', '성공해야 함', ntsResult.ok],
    ['복호화 결과가 원문과 일치', '일치해야 함', matches],
  ];

  console.log('  경로                                        기대          결과');
  console.log(`  ${'─'.repeat(70)}`);
  for (const [label, expected, ok] of rows) {
    console.log(`  ${label.padEnd(42, ' ')}${expected.padEnd(14, ' ')}${ok ? '✅' : '❌'}`);
  }

  const passed = rows.every(([, , ok]) => ok);

  console.log(`\n${LINE}`);
  console.log(
    passed
      ? 'PHASE 4 완료 — 사장님은 모든 경로에서 복호화 실패, 국세청만 성공'
      : 'PHASE 4 실패 — 위 표를 확인하세요',
  );
  console.log(LINE);

  console.log('\n  한계 (§15):');
  console.log('    · 현행 소득세법상 지급명세서에 주민번호 기재가 필요하므로,');
  console.log('      번호를 없애는 게 아니라 **사업주를 거치지 않게** 하는 것이다.');
  console.log('    · 실제로 동작하려면 홈택스가 이 봉인 포맷을 수용해야 한다.');
  console.log('      여기 국세청은 목업이다.');

  if (!passed) process.exitCode = 1;
}

/** JWE 의 ciphertext 세그먼트 첫 글자를 바꾼다. */
function tamperCiphertext(jwe: string): string {
  const parts = jwe.split('.');
  const ciphertext = parts[3];
  if (!ciphertext) throw new Error('JWE Compact 형식이 아닙니다');
  parts[3] = (ciphertext[0] === 'A' ? 'B' : 'A') + ciphertext.slice(1);
  return parts.join('.');
}

main().catch((error: unknown) => {
  console.error('\n실행 중 오류:', error);
  process.exitCode = 1;
});
