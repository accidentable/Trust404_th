/**
 * 살아 있는 서버를 상대로 관객 흐름을 끝까지 돌려 보고, 검증 11개를 전부 찍는다.
 *
 *   npm run dev 가 떠 있는 상태에서:  npx tsx scripts/verify-live.ts
 *   다른 주소면:                        BASE=https://... npx tsx scripts/verify-live.ts
 *
 * 사장님 브라우저(/merchant)가 하는 검증과 같은 코드(EmployerVerifier)를 같은 옵션으로 호출한다.
 * 서버는 발급·봉인·중계만 하고 검증하지 않는다는 것을 이 스크립트가 그대로 보여준다.
 */
import { HolderWallet } from '../src/holder/wallet';
import { EmployerVerifier } from '../src/verifier/employer';
import { DEFAULT_CASE, VCT_RESIDENT_ID } from '../src/shared/schema';
import type { ChainCall, RevocationRegistry } from '../src/shared/revocation';
import type {
  IssueResponse,
  IssuerInfo,
  MerchantRegistered,
  MerchantSessions,
  SessionCreated,
} from '../src/shared/api';
import { groupChecks } from '../src/ui/verification';

const BASE = process.env.BASE ?? 'http://localhost:3000';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** 사장님 화면의 RemoteRevocationRegistry 와 같은 동작, 절대 주소만 붙인 것. */
const registry: RevocationRegistry = {
  label: 'REMOTE STUB · IssuerRegistry',
  isStub: true,
  async isRevoked(statusIndex) {
    const { revoked } = await call<{ revoked: boolean }>(`/api/revocation/${statusIndex}`);
    const callRecord: ChainCall = { kind: 'read', method: 'isRevoked', argument: statusIndex, result: String(revoked), at: Date.now() };
    return { revoked, call: callRecord };
  },
  async revoke(statusIndex) {
    const { txHash } = await call<{ txHash: string }>(`/api/revocation/${statusIndex}`, {});
    const callRecord: ChainCall = { kind: 'write', method: 'revoke', argument: statusIndex, result: 'ok', txHash, at: Date.now() };
    return { call: callRecord };
  },
};

const line = (s = '') => console.log(s);

async function main(): Promise<void> {
  line(`서버: ${BASE}`);

  // 1. 발급기관 — 서버가 든 주민센터 키
  const issuer = await call<IssuerInfo>('/api/issuer');
  line(`\n[1] 발급기관  ${issuer.did}  (형식 v${issuer.version})`);

  // 2. 사장님 — 요청 템플릿 등록 (화면의 /merchant 가 하는 것과 같음)
  const { merchantId } = await call<MerchantRegistered>('/api/merchant', {
    verifier: DEFAULT_CASE.verifier,
    purpose: DEFAULT_CASE.purpose,
    requested: DEFAULT_CASE.required,
  });
  line(`[2] 사장님    템플릿 등록  merchantId=${merchantId}  요청=${DEFAULT_CASE.required.join(',')}`);

  // 3. 알바생 — 키 생성 + 서버 발급 (폰의 /wallet 이 하는 것과 같음)
  const wallet = new HolderWallet();
  const issued = await call<IssueResponse>('/api/issue', { holderPublicJwk: wallet.publicJwk });
  const stored = await wallet.save(issued.credential);
  line(`[3] 알바생    발급받음  이름=${issued.name}  폐기인덱스=${stored.statusIndex}  봉인=${stored.sealedClaims.join(',')}`);
  line(`              지갑 DID  ${wallet.did}`);

  // 4. 세션 — 새 nonce 가 든 요청
  const session = await call<SessionCreated>('/api/session', { merchantId });
  line(`[4] 세션      sessionId=${session.sessionId}  nonce=${session.request.nonce}`);

  // 5. 제시 — 홀더 개인키로 KB-JWT 서명 (폰에서 일어나는 일)
  const plan = wallet.reviewRequest(stored.id, session.request);
  const vp = await wallet.presentPlan(stored.id, plan);
  await call<{ ok: boolean }>(`/api/session/${session.sessionId}/vp`, { vp });
  line(`[5] 제시      보여줌=${plan.shown.map((i) => i.key).join(',')}  잠김=${plan.sealed.map((i) => i.key).join(',')}  안보냄=${plan.withheld.map((i) => i.key).join(',')}`);
  line(`              VP 길이 ${vp.length}자, 조각 ${vp.split('~').length - 2}개 + KB-JWT`);

  // 6. 사장님 — 서버에서 VP 를 받아 브라우저에서 하는 검증을 그대로 수행
  const { sessions } = await call<MerchantSessions>(`/api/merchant/${merchantId}/sessions`);
  const mine = sessions.find((s) => s.sessionId === session.sessionId);
  if (!mine?.vp) throw new Error('서버에서 제시를 받지 못했다');

  const employer = new EmployerVerifier();
  const report = await employer.verify(mine.vp, {
    trustedIssuers: [issuer.did],
    expectedVct: VCT_RESIDENT_ID,
    request: mine.request,
    revocationRegistry: registry,
  });

  line(`\n[6] 검증 (사장님 브라우저와 같은 코드)  →  ${report.ok ? '통과' : '거부'}`);
  line('    내부 검사 11개:');
  for (const c of report.checks) line(`      ${c.ok ? '✓' : '✕'} ${c.id.padEnd(20)} ${c.label.padEnd(14)} ${c.detail}`);
  line('    화면의 4줄로 묶으면:');
  for (const g of groupChecks(report.checks)) line(`      ${g.ok ? '✓' : '✕'} ${g.label}${g.detail ? `  (${g.detail})` : ''}`);

  line('\n    사장님이 받은 것:');
  for (const d of report.audit.disclosed) line(`      ${d.key} = ${JSON.stringify(d.value)}`);
  for (const k of Object.keys(report.audit.sealed)) line(`      ${k} = 🔒 JWE ${report.audit.sealed[k]?.slice(0, 40)}…  (열 수 없음)`);
  line(`      해시로만 남은 항목 ${report.audit.withheldDigests.length}개`);

  // 7. 사장님이 열어 보기 — 실패해야 정상
  const attempts = await employer.tryOpenSealed(report.audit.sealed.rrn_sealed ?? '');
  line(`\n[7] 사장님 [열어 보기]  →  ${attempts.every((a) => !a.ok) ? '❌ 복호화 실패 (정상)' : '열림 (버그)'}`);

  // 8. 국세청 — 웹 흐름에는 없다
  line('\n[8] 국세청 봉인 해제  →  웹 경로 없음. 서버는 국세청 키를 들고 있지만 여는 엔드포인트가 없다.');
  line('    성공 경로는 콘솔 시연(npm run phase4)에만 있다.');

  if (!report.ok) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error('\n실패:', (e as Error).message);
  process.exitCode = 1;
});
