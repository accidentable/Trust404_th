import type { Express } from 'express';
import type { JWK } from 'jose';
import type { ResidentCenterIssuer } from '../src/issuer/residentCenter';
import type { NationalTaxService } from '../src/tax/nationalTaxService';
import { EmployerVerifier } from '../src/verifier/employer';
import { auditDisclosures, decodeJwtPayload, splitPresentation } from '../src/verifier/disclosureAudit';
import { createPresentationRequest } from '../src/verifier/request';
import { groupChecks } from '../src/verifier/summary';
import { DEFAULT_CASE, VCT_RESIDENT_ID } from '../src/shared/schema';
import { describeSeal } from '../src/shared/sealing';
import { randomBytes } from '../src/shared/crypto';
import type { ResidentIdSubject } from '../src/shared/types';
import { nextAudienceSubject } from './authorities';
import type { MemoryStore } from './store';
import { DemoHolders, describeCredential } from './demoRoles';
import type { RegistrySetup } from './chain';

/**
 * 역할별 API. 네 단계의 내용을 JSON 으로 그대로 확인한다.
 *
 *   1. 주민센터  POST /api/issuer/issue              번호를 주면 발급. 봉인된 VC 의 속을 보여준다
 *   2. 나        GET  /api/holder/:holderId          지갑이 보관 중인 것
 *               POST /api/holder/:holderId/present  사장님에게 제시 (보낸 것 / 잠긴 것 / 안 보낸 것)
 *   3. 사장님    GET  /api/verifier/:sessionId       검사 11개 + 4줄 + 사장님 눈에 보이는 것
 *               POST /api/verifier/:sessionId/open  봉인을 열어 본다. 실패한다
 *   4. 국세청    POST /api/tax/unseal                봉인을 연다. 지급명세서
 *
 * 홀더는 여기서는 서버가 대신 든다(내용 확인용). 폰 흐름(/wallet)에서는 키가 폰에만 있다.
 * 발급·제시·검증·봉인 코드는 두 경로가 같은 것을 쓴다.
 */
const hex = (bytes: number) => [...randomBytes(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const DEMO_MERCHANT_ID = 'api-demo';
const DEMO_PAYMENT = 150_000;

interface Deps {
  store: MemoryStore;
  residentCenter: ResidentCenterIssuer;
  taxService: NationalTaxService;
  holders: DemoHolders;
  /** 폐기 레지스트리. 체인 또는 스텁. 발급기관용(쓰기)과 검증자용(읽기)이 나뉜다. */
  registry: RegistrySetup;
}

export function registerRoleRoutes(app: Express, { store, residentCenter, taxService, holders, registry }: Deps): void {
  const employer = new EmployerVerifier();

  // ── 1. 주민센터 (Issuer) ────────────────────────────────────────
  app.post('/api/issuer/issue', async (req, res) => {
    const body = req.body as { subject?: Partial<ResidentIdSubject>; holderPublicJwk?: JWK; holderId?: string };
    const given = body.subject ?? {};
    // 입력하지 않은 항목만 더미로 채운다. 이름·번호를 다 주면 이름 풀을 소모하지 않는다.
    const base = given.name && given.birthDate && given.rrn ? null : nextAudienceSubject();
    const subject: ResidentIdSubject = {
      name: given.name?.trim() || base?.name || '',
      birthDate: given.birthDate?.trim() || base?.birthDate || '',
      address: given.address?.trim() || base?.address || '(수집하지 않음)',
      rrn: given.rrn?.trim() || base?.rrn || '',
    };
    if (!/^\d{6}-\d{7}$/.test(subject.rrn)) {
      res.status(400).json({ error: '주민등록번호는 000000-0000000 형식이어야 합니다' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(subject.birthDate)) {
      res.status(400).json({ error: '생년월일은 YYYY-MM-DD 형식이어야 합니다' });
      return;
    }

    // 홀더 공개키: 폰이 보내 준 것 / 기존 API 홀더 / 새 API 홀더
    let holder = body.holderId ? holders.get(body.holderId) : undefined;
    let holderPublicJwk = body.holderPublicJwk;
    if (!holderPublicJwk) {
      holder ??= holders.create();
      holderPublicJwk = holder.wallet.publicJwk;
    }

    const issued = await residentCenter.issueResidentId(subject, {
      holderPublicJwk,
      taxAuthorityPublicJwk: taxService.publicJwk,
    });
    if (holder) await holder.wallet.save(issued.credential);

    const plaintextRrnInCredential =
      issued.credential.includes(subject.rrn) || issued.credential.includes(subject.rrn.replace('-', ''));

    res.json({
      role: '주민센터 (Issuer)',
      input: { ...subject, rrn: `${subject.rrn.slice(0, 8)}******` },
      issuerDid: residentCenter.did,
      holderId: holder?.holderId ?? null,
      plaintextRrnInCredential,
      credential: await describeCredential(issued.credential),
      note: '주민등록번호는 발급 즉시 국세청 공개키로 봉인되어 credential.sealed.rrn_sealed 에만 있다. 사진 업로드 단계는 없다.',
      next: holder ? `GET /api/holder/${holder.holderId}` : '폰 지갑이 credential.raw 를 보관한다',
    });
  });

  /**
   * 분실 신고 = 폐기. 발급기관만 한다. 레지스트리에는 인덱스 번호만 올라간다.
   * 체인이면 트랜잭션이 블록에 들어갈 때까지 기다렸다가 tx 해시와 익스플로러 링크를 돌려준다.
   */
  app.post('/api/issuer/revoke', async (req, res) => {
    if (!process.env.DEMO_ADMIN_TOKEN || req.headers.authorization !== `Bearer ${process.env.DEMO_ADMIN_TOKEN}`) { res.status(403).json({ error: '관리자 인증이 필요합니다.' }); return; }
    const { statusIndex } = req.body as { statusIndex?: unknown };
    const index = Number(statusIndex);
    if (!Number.isInteger(index) || index < 0) {
      res.status(400).json({ error: 'statusIndex 가 정수가 아닙니다' });
      return;
    }
    try {
      const { call } = await registry.issuerRegistry.revoke(index);
      res.json({
        role: '주민센터 (Issuer)',
        statusIndex: index,
        registry: registry.issuerRegistry.label,
        call,
        note: '체인에 올라간 것은 인덱스 번호와 폐기 여부뿐이다. 이 번호가 누구인지는 주민센터만 안다. 사장님이 다시 검증하면 폐기 여부 확인에서 걸린다.',
      });
    } catch (e) {
      res.status(502).json({ error: `폐기 기록 실패: ${(e as Error).message}` });
    }
  });

  // ── 2. 나 (Holder) ──────────────────────────────────────────────
  app.get('/api/holder/:holderId', async (req, res) => {
    const holder = holders.get(String(req.params.holderId));
    if (!holder) {
      res.status(404).json({ error: '없는 홀더입니다. 먼저 POST /api/issuer/issue 로 발급받으세요.' });
      return;
    }
    const credentials = await Promise.all(
      holder.wallet.list().map(async (stored) => ({ id: stored.id, ...(await describeCredential(stored.credential)) })),
    );
    res.json({
      role: '나 (Holder)',
      holderId: holder.holderId,
      did: holder.wallet.did,
      privateKey: 'API 시연용 홀더라 서버 메모리에만 있다. 폰 흐름(/wallet)에서는 폰의 IndexedDB 에만 있고 서버로 오지 않는다.',
      credentials,
      next: `POST /api/holder/${holder.holderId}/present  { "merchantId"?: string, "deny"?: string[] }`,
    });
  });

  app.post('/api/holder/:holderId/present', async (req, res) => {
    const holder = holders.get(String(req.params.holderId));
    if (!holder) {
      res.status(404).json({ error: '없는 홀더입니다' });
      return;
    }
    const body = req.body as { merchantId?: string; deny?: string[] };
    const stored = holder.wallet.list().at(-1);
    if (!stored) {
      res.status(409).json({ error: '보관 중인 자격증명이 없습니다' });
      return;
    }
    const template = body.merchantId ? store.merchants.get(body.merchantId) : undefined;
    if (body.merchantId && !template) {
      res.status(404).json({ error: '등록되지 않은 사장님 화면입니다' });
      return;
    }

    const request = createPresentationRequest({
      verifier: template?.verifier ?? DEFAULT_CASE.verifier,
      purpose: template?.purpose ?? DEFAULT_CASE.purpose,
      requested: template?.requested ?? DEFAULT_CASE.required,
    });
    const plan = holder.wallet.reviewRequest(stored.id, request, { deny: body.deny ?? [] });
    const vp = await holder.wallet.presentPlan(stored.id, plan);

    const sessionId = hex(12);
    const now = Date.now();
    store.sessions.put({
      sessionId,
      merchantId: template?.merchantId ?? DEMO_MERCHANT_ID,
      request,
      vp,
      createdAt: now,
      presentedAt: now,
    });

    const { keyBindingJwt, disclosures } = splitPresentation(vp);
    res.json({
      role: '나 (Holder)',
      sessionId,
      request,
      sent: {
        shown: plan.shown.map((item) => ({ key: item.key, label: item.label, value: item.value })),
        sealed: plan.sealed.map((item) => ({ key: item.key, label: item.label })),
        withheld: plan.withheld.map((item) => ({ key: item.key, label: item.label })),
      },
      presentation: {
        disclosures: disclosures.length,
        keyBindingJwt: keyBindingJwt ? decodeJwtPayload(keyBindingJwt) : null,
        raw: vp,
      },
      note: '본체 JWT 는 손대지 않고 조각만 골라 붙였다. KB-JWT 는 이 홀더의 개인키로 사장님의 nonce 에 서명한 것이다.',
      next: `GET /api/verifier/${sessionId}`,
    });
  });

  // ── 3. 사장님 (Verifier) ────────────────────────────────────────
  app.get('/api/verifier/:sessionId', async (req, res) => {
    const session = store.sessions.get(String(req.params.sessionId));
    if (!session?.vp) {
      res.status(404).json({ error: '제시가 없는 세션입니다' });
      return;
    }
    const report = await employer.verify(session.vp, {
      trustedIssuers: [residentCenter.did],
      expectedVct: VCT_RESIDENT_ID,
      request: session.request,
      revocationRegistry: registry.verifierRegistry,
    });
    res.json({
      role: '사장님 (Verifier)',
      sessionId: session.sessionId,
      ok: report.ok,
      summary: groupChecks(report.checks),
      checks: report.checks,
      sees: {
        disclosed: report.audit.disclosed.map((claim) => ({ key: claim.key, value: claim.value })),
        sealed: Object.fromEntries(
          Object.entries(report.audit.sealed).map(([key, jwe]) => [key, { ...describeSeal(jwe), preview: `${jwe.slice(0, 48)}…` }]),
        ),
        withheldDigests: report.audit.withheldDigests,
      },
      requestSatisfied: report.request ?? null,
      note: '검증은 서버가 아니라 사장님이 한다. 이 응답은 사장님 브라우저가 돌리는 것과 같은 코드를 같은 옵션으로 돌린 것이다.',
      next: `POST /api/verifier/${session.sessionId}/open  (실패해야 정상)  →  POST /api/tax/unseal { "sessionId": "${session.sessionId}" }`,
    });
  });

  app.post('/api/verifier/:sessionId/open', async (req, res) => {
    const session = store.sessions.get(String(req.params.sessionId));
    if (!session?.vp) {
      res.status(404).json({ error: '제시가 없는 세션입니다' });
      return;
    }
    const sealed = auditDisclosures(session.vp).sealed.rrn_sealed;
    if (!sealed) {
      res.status(404).json({ error: '봉인 필드가 없는 제시입니다' });
      return;
    }
    const attempts = await employer.tryOpenSealed(sealed, [taxService.publicJwk]);
    res.json({
      role: '사장님 (Verifier)',
      opened: attempts.some((attempt) => attempt.ok),
      attempts,
      note: '사장님 개인키로도, 국세청 공개키로도 열리지 않는다. 공개키로는 봉인을 만들 수만 있다.',
    });
  });

  // ── 4. 국세청 ───────────────────────────────────────────────────
  app.post('/api/tax/unseal', async (req, res) => {
    const body = req.body as { sessionId?: string; rrn_sealed?: string };
    let jwe = body.rrn_sealed;
    let name: unknown;
    if (!jwe && body.sessionId) {
      const session = store.sessions.get(body.sessionId);
      if (!session?.vp) {
        res.status(404).json({ error: '제시가 없는 세션입니다' });
        return;
      }
      const audit = auditDisclosures(session.vp);
      jwe = audit.sealed.rrn_sealed;
      name = audit.disclosed.find((claim) => claim.key === 'name')?.value;
    }
    if (!jwe) {
      res.status(400).json({ error: 'sessionId 또는 rrn_sealed 가 필요합니다' });
      return;
    }
    const result = await taxService.unsealRrn(jwe);
    if (!result.ok) {
      res.status(400).json({ error: '복호화 실패', detail: result.error });
      return;
    }
    res.json({
      role: '국세청',
      seal: describeSeal(jwe),
      rrn: result.plaintext,
      statement: {
        서식: '일용근로소득 지급명세서',
        성명: name ?? '(제시에 성명 없음)',
        주민등록번호: result.plaintext,
        지급액: DEMO_PAYMENT,
        원천징수세액: 0,
      },
      note: '사장님이 신고서에 그대로 첨부한 봉인을 국세청 개인키로 연다. 사장님 손에는 번호가 남지 않는다. 실제로는 홈택스가 이 포맷을 수용해야 한다.',
    });
  });
}
