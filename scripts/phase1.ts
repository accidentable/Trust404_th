/**
 * Phase 1 — 뼈대와 키
 * 완료 조건: 콘솔에서 발급 → 검증 왕복 1회 통과
 *
 *   주민센터(Issuer) ──VC──▶ 지갑(Holder) ──VP──▶ 사장님(Verifier)
 *
 * 아직 없는 것: 폐기(온체인, Phase 6) · 계좌 VC(Phase 7) · UI(Phase 5)
 */
import { ResidentCenterIssuer } from '../src/issuer/residentCenter';
import { HolderWallet } from '../src/holder/wallet';
import { EmployerVerifier } from '../src/verifier/employer';
import { NationalTaxService } from '../src/tax/nationalTaxService';
import { RESIDENT_ID_SELECTIVE_CLAIMS, VCT_RESIDENT_ID, nowInSeconds } from '../src/shared/schema';
import { splitPresentation } from '../src/verifier/disclosureAudit';
import { ed25519PublicKeyFromDidKey, shortenDid } from '../src/shared/did';
import { base58btcDecode, base58btcEncode } from '../src/shared/base58';

const LINE = '─'.repeat(72);

function step(n: number, title: string): void {
  console.log(`\n${LINE}\n[${n}] ${title}\n${LINE}`);
}

/** base58btc 을 직접 구현했으므로(§13 표에 base58 라이브러리 없음) 알려진 벡터로 확인한다. */
function selfTestBase58(): void {
  const knownDidKey = 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'; // W3C did:key 문서의 Ed25519 예시
  const decoded = base58btcDecode(knownDidKey.slice(1));
  const reencoded = `z${base58btcEncode(decoded)}`;

  const prefixOk = decoded[0] === 0xed && decoded[1] === 0x01;
  const lengthOk = decoded.length === 34;
  const roundTripOk = reencoded === knownDidKey;

  if (!prefixOk || !lengthOk || !roundTripOk) {
    throw new Error('base58btc 자체 검사 실패');
  }
  console.log(
    `  base58btc 자체 검사 통과 — W3C did:key 예시를 디코딩하면 ${decoded.length}바이트, ` +
      'multicodec 0xed01(ed25519-pub), 재인코딩 결과 원문과 일치',
  );
}

async function main(): Promise<void> {
  console.log('TRUST404 트랙 02 — Phase 1: 발급 → 검증 왕복');

  step(0, '자체 검사 — base58btc / did:key');
  selfTestBase58();

  // ──────────────────────────────────────────────────────────────────
  step(1, '키 생성 — 각 주체는 자기 키만 갖는다');

  const residentCenter = new ResidentCenterIssuer(); // 주민센터 (Issuer)
  const wallet = new HolderWallet(); // 나 (Holder)
  const employer = new EmployerVerifier(); // 사장님 (Verifier)
  const nts = new NationalTaxService(); // 국세청 (봉인 수신자)

  console.log(`  주민센터(Issuer)   ${residentCenter.did}`);
  console.log(`  나(Holder)         ${wallet.did}`);
  console.log('  사장님(Verifier)   발급키 없음 — 검증만 한다');
  console.log(`  국세청(봉인 수신)   ${nts.did}  (X25519)`);
  console.log(
    `\n  did:key 왕복 확인: DID 문자열에서 바로 공개키 ${ed25519PublicKeyFromDidKey(residentCenter.did).length}바이트를 꺼냈다 (네트워크 조회 없음)`,
  );

  // ──────────────────────────────────────────────────────────────────
  step(2, '발급 — 주민센터가 신분 VC 를 서명한다');

  // 주민센터 DB 에 이미 있는 값이다. 신분증을 촬영해 올리는 단계는 없다. (§11)
  const subject = {
    name: '윤태호',
    address: '서울특별시 성북구 안암로 145',
    birthDate: '2001-03-14',
    rrn: '010314-3000000', // 국세청 공개키로 봉인되어 rrn_sealed 에 들어간다 (Phase 4)
  };

  const issued = await residentCenter.issueResidentId(subject, {
    holderPublicJwk: wallet.publicJwk, // cnf — 이 VC 는 이 지갑 것
    taxAuthorityPublicJwk: nts.publicJwk, // rrn_sealed — 국세청만 열 수 있다
  });

  const parts = splitPresentation(issued.credential);
  console.log(`  vct              ${VCT_RESIDENT_ID}`);
  console.log(`  선택적 공개 항목   ${RESIDENT_ID_SELECTIVE_CLAIMS.join(', ')}`);
  console.log(`  statusIndex      ${issued.statusIndex}  (난수 배정 — 순차면 발급 순서가 드러난다)`);
  console.log(`  발급 결과         본체 JWT 1개 + 조각 ${parts.disclosures.length}개, 총 ${issued.credential.length}자`);
  console.log(`\n  본체 JWT(앞 80자)  ${parts.jwt.slice(0, 80)}…`);

  // ──────────────────────────────────────────────────────────────────
  step(3, '보관 — 지갑에 저장한다');

  const stored = await wallet.save(issued.credential);
  console.log(`  id               ${stored.id}`);
  console.log(`  발급기관          ${shortenDid(stored.issuerDid)}`);
  console.log(`  만료              ${new Date(stored.expiresAt * 1000).toISOString()}`);
  console.log('  개인키            지갑 밖으로 나가지 않는다');

  // ──────────────────────────────────────────────────────────────────
  step(4, '제시 — 지갑이 VP 를 만든다');

  // Phase 1 에서는 전 항목을 공개한다. 항목을 골라내는 선택적 공개는 Phase 2.
  const presentation = await wallet.present(stored.id, [...RESIDENT_ID_SELECTIVE_CLAIMS]);
  const vpParts = splitPresentation(presentation);
  console.log(`  붙여 보낸 조각     ${vpParts.disclosures.length}개 (${RESIDENT_ID_SELECTIVE_CLAIMS.join(', ')})`);
  console.log('  본체 JWT          건드리지 않음 → 발급자 서명 그대로 유효');
  console.log('  KB-JWT            없음 (Phase 3 에서 추가)');

  // ──────────────────────────────────────────────────────────────────
  step(5, '검증 — 사장님이 직접 확인한다');

  const report = await employer.verify(presentation, {
    trustedIssuers: [residentCenter.did],
    expectedVct: VCT_RESIDENT_ID,
  });

  for (const check of report.checks) {
    console.log(`  ${check.ok ? '✅' : '❌'} ${check.label.padEnd(20, ' ')} ${check.detail}`);
  }

  // ──────────────────────────────────────────────────────────────────
  step(6, '공개 범위 — 검증자가 실제로 본 것');

  console.log('  보여줌 (조각이 함께 와서 값까지 보임)');
  for (const claim of report.audit.disclosed) {
    console.log(`    ✓ ${claim.key.padEnd(11, ' ')} ${JSON.stringify(claim.value)}`);
    console.log(`        salt=${claim.salt}  digest=${claim.digest}`);
  }

  console.log('\n  보내지 않음 (본체에 해시만 남음)');
  if (report.audit.withheldDigests.length === 0) {
    console.log('    (없음 — Phase 1 은 전 항목 공개. 골라 보내기는 Phase 2)');
  } else {
    for (const digest of report.audit.withheldDigests) {
      console.log(`    ✗ (이름도 값도 알 수 없음)  digest=${digest}`);
    }
  }

  console.log('\n  항상 따라오는 평문 필드');
  for (const [key, value] of Object.entries(report.audit.alwaysPresent)) {
    console.log(`    · ${key.padEnd(11, ' ')} ${JSON.stringify(value)}`);
  }

  console.log('  잠긴 채 따라온 필드');
  for (const [key, value] of Object.entries(report.audit.sealed)) {
    console.log(`    🔒 ${key.padEnd(11, ' ')} ${String(value).slice(0, 40)}…  (국세청만 열 수 있음)`);
  }

  // ──────────────────────────────────────────────────────────────────
  step(7, '역검사 — 변조하면 정말 막히는가');

  const trust = { trustedIssuers: [residentCenter.did], expectedVct: VCT_RESIDENT_ID };

  // 조각의 value 를 바꿔치기한다 — 해시가 달라져야 한다.
  const tamperedReport = await employer.verify(tamperFirstDisclosure(presentation), trust);
  report_line('조각 값 변조', tamperedReport, 'disclosure-digests');

  // 본체 JWT 서명의 한 글자를 바꾼다.
  const forgedReport = await employer.verify(forgeSignature(presentation), trust);
  report_line('서명 위조', forgedReport, 'issuer-signature');

  // 이미 만료된 VC
  const expiredIssue = await residentCenter.issueResidentId(subject, {
    holderPublicJwk: wallet.publicJwk,
    taxAuthorityPublicJwk: nts.publicJwk,
    issuedAt: nowInSeconds() - 7200,
    ttlSeconds: 3600,
  });
  const expiredStored = await wallet.save(expiredIssue.credential);
  const expiredVp = await wallet.present(expiredStored.id, [...RESIDENT_ID_SELECTIVE_CLAIMS]);
  const expiredReport = await employer.verify(expiredVp, trust);
  report_line('만료된 VC', expiredReport, 'validity');

  // 신뢰 목록에 없는 발급기관이 서명한 VC
  const rogue = new ResidentCenterIssuer();
  const rogueIssue = await rogue.issueResidentId(subject, {
    holderPublicJwk: wallet.publicJwk,
    taxAuthorityPublicJwk: nts.publicJwk,
  });
  const rogueStored = await wallet.save(rogueIssue.credential);
  const rogueVp = await wallet.present(rogueStored.id, [...RESIDENT_ID_SELECTIVE_CLAIMS]);
  const rogueReport = await employer.verify(rogueVp, trust);
  report_line('가짜 발급기관', rogueReport, 'issuer-trusted');

  // ──────────────────────────────────────────────────────────────────
  const passed =
    report.ok && !tamperedReport.ok && !forgedReport.ok && !expiredReport.ok && !rogueReport.ok;

  console.log(`\n${LINE}`);
  console.log(
    passed
      ? 'PHASE 1 완료 — 정상 왕복 1회 통과, 변조·위조·만료·미신뢰 발급기관 4건 모두 거부'
      : 'PHASE 1 실패 — 위 결과를 확인하세요',
  );
  console.log(LINE);

  if (!passed) process.exitCode = 1;
}

function report_line(
  label: string,
  result: { ok: boolean; checks: { id: string; detail: string }[] },
  checkId: string,
): void {
  const check = result.checks.find((c) => c.id === checkId);
  console.log(`  ${label.padEnd(14, ' ')} → ${result.ok ? '❌ 통과해버림 (버그)' : '✅ 거부됨'}`);
  console.log(`      ${check?.detail ?? ''}`);
}

/** 조각의 value 를 바꿔치기한다. */
function tamperFirstDisclosure(presentation: string): string {
  const { jwt, disclosures } = splitPresentation(presentation);
  const first = disclosures[0];
  if (!first) throw new Error('변조할 조각이 없습니다');

  const [salt, key] = JSON.parse(Buffer.from(first, 'base64url').toString('utf8')) as [
    string,
    string,
    unknown,
  ];
  const reencoded = Buffer.from(JSON.stringify([salt, key, '변조된값']), 'utf8').toString(
    'base64url',
  );
  return [jwt, reencoded, ...disclosures.slice(1), ''].join('~');
}

/** 본체 JWT 서명의 첫 글자를 뒤집는다. */
function forgeSignature(presentation: string): string {
  const { jwt, disclosures } = splitPresentation(presentation);
  const [header, payload, signature] = jwt.split('.') as [string, string, string];
  const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  return [[header, payload, flipped].join('.'), ...disclosures, ''].join('~');
}

main().catch((error) => {
  console.error('\n실행 중 오류:', error);
  process.exitCode = 1;
});
