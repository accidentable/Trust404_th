import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextAudienceSubject, residentCenter, taxService } from './authorities';
import { MemoryStore } from './store';
import { DemoHolders } from './demoRoles';
import { registerRoleRoutes } from './roleRoutes';
import { setupRegistry } from './chain';
import { createPresentationRequest } from '../src/verifier/request';
import { randomBytes } from '../src/shared/crypto';
import type {
  IssueRequest,
  IssueResponse,
  IssuerInfo,
  MerchantRegistered,
  MerchantSessions,
  MerchantTemplate,
  SessionCreateRequest,
  SessionCreated,
} from '../src/shared/api';

/**
 * 세션 서버 (§13) — 시연 편의용 중계 서버.
 *
 *   dev : `npm run dev`   Vite 를 미들웨어로 품고 한 포트에서 API + 프론트
 *   prod: `npm start`     dist/ 를 정적으로 서빙 (Dockerfile 이 이걸 실행)
 *
 * 단일 인스턴스 전제. 세션은 메모리 Map, 30분 TTL.
 */
const PORT = Number(process.env.PORT ?? 3000);
const PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const SESSION_TTL_MS = 30 * 60 * 1000;
/**
 * 발급 형식 버전. 이름 규칙·클레임 구성 등 발급 내용이 바뀌면 올린다.
 * 지갑은 저장된 신분증의 버전이 다르면 자동으로 다시 발급받는다.
 *   v1  "관객N"
 *   v2  이름 풀 30개
 */
const CREDENTIAL_VERSION = 2;
const here = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json({ limit: '64kb' }));
const store = new MemoryStore(SESSION_TTL_MS);
// 폐기 레지스트리: 환경변수(REGISTRY_ADDRESS, RPC_URL, CHAIN_ID)가 있으면 체인, 없으면 메모리 스텁.
const registrySetup = setupRegistry();

// API 요청 로그 한 줄. 시연 중 "지금 뭐가 오가고 있나"를 서버 콘솔에서 바로 본다.
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) {
    next();
    return;
  }
  const started = Date.now();
  res.on('finish', () => {
    console.log(`[api] ${req.method} ${req.path} → ${res.statusCode} (${Date.now() - started}ms)`);
  });
  next();
});

const hex = (bytes: number) => [...randomBytes(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

// ── 발급기관 ────────────────────────────────────────────────────────
app.get('/api/issuer', (_req, res) => {
  const body: IssuerInfo = { did: residentCenter.did, version: CREDENTIAL_VERSION };
  res.json(body);
});

/** 관객 폰이 첫 진입 때 부른다. 이름 "관객N", 주민번호 더미 — 실제 개인정보는 없다. */
app.post('/api/issue', async (req, res) => {
  const body = req.body as Partial<IssueRequest>;
  if (!body.holderPublicJwk) {
    res.status(400).json({ error: 'holderPublicJwk 가 필요합니다' });
    return;
  }
  const subject = nextAudienceSubject();
  const issued = await residentCenter.issueResidentId(subject, {
    holderPublicJwk: body.holderPublicJwk,
    taxAuthorityPublicJwk: taxService.publicJwk,
  });
  const out: IssueResponse = {
    credential: issued.credential,
    name: subject.name,
    issuerDid: residentCenter.did,
    version: CREDENTIAL_VERSION,
  };
  res.json(out);
});

// ── 사장님 화면 ─────────────────────────────────────────────────────
/** 요청 템플릿 등록. merchantId 를 주면 그대로 재등록한다 (새로고침·서버 재시작 대비). */
app.post('/api/merchant', (req, res) => {
  const body = req.body as Partial<MerchantTemplate>;
  if (!body.verifier || !body.purpose || !Array.isArray(body.requested)) {
    res.status(400).json({ error: 'verifier, purpose, requested 가 필요합니다' });
    return;
  }
  const merchantId =
    typeof body.merchantId === 'string' && /^[0-9a-f]{16}$/.test(body.merchantId) ? body.merchantId : hex(8);
  store.merchants.set(merchantId, {
    merchantId,
    verifier: body.verifier,
    purpose: body.purpose,
    requested: body.requested.map(String),
  });
  const out: MerchantRegistered = { merchantId };
  res.json(out);
});

/** 들어온 제시 목록 — 제시가 도착한 세션만. 검증은 사장님 브라우저가 한다. */
app.get('/api/merchant/:merchantId/sessions', (req, res) => {
  const out: MerchantSessions = {
    sessions: store.sessions.listByMerchant(String(req.params.merchantId)).filter((s) => s.vp !== undefined),
  };
  res.json(out);
});

// ── 세션 (제시 한 건) ────────────────────────────────────────────────
/** 관객 폰이 QR 로 들어와서 부른다. 템플릿에 새 nonce 를 붙여 요청을 만든다. */
app.post('/api/session', (req, res) => {
  const { merchantId } = req.body as Partial<SessionCreateRequest>;
  const template = merchantId ? store.merchants.get(merchantId) : undefined;
  if (!template) {
    res.status(404).json({ error: '등록되지 않은 사장님 화면입니다. 사장님 화면을 새로고침한 뒤 QR 을 다시 띄우세요.' });
    return;
  }
  const request = createPresentationRequest({
    verifier: template.verifier,
    purpose: template.purpose,
    requested: template.requested,
  });
  const sessionId = hex(12);
  store.sessions.put({ sessionId, merchantId: template.merchantId, request, createdAt: Date.now() });
  const out: SessionCreated = { sessionId, request };
  res.json(out);
});

app.post('/api/session/:id/vp', (req, res) => {
  const record = store.sessions.get(String(req.params.id));
  if (!record) {
    res.status(404).json({ error: '세션이 없거나 만료되었습니다' });
    return;
  }
  if (record.vp !== undefined) {
    res.status(409).json({ error: '이미 제시된 세션입니다' });
    return;
  }
  if (new Date(record.request.expiresAt).getTime() < Date.now()) {
    res.status(410).json({ error: '제시 요청이 만료되었습니다. QR 을 다시 찍으세요.' });
    return;
  }
  const { vp } = req.body as { vp?: unknown };
  if (typeof vp !== 'string' || vp.length === 0 || vp.length > 16_000) {
    res.status(400).json({ error: 'vp 가 올바르지 않습니다' });
    return;
  }
  store.sessions.put({ ...record, vp, presentedAt: Date.now() });
  res.json({ ok: true });
});

// ── 폐기 레지스트리 (Phase 6) ─────────────────────────────────────────
/** 브라우저가 체인 설정을 받아 RPC 를 직접 읽는다. 설정이 없으면 스텁이라고 알려 준다. */
app.get('/api/chain', (_req, res) => {
  res.json({
    configured: registrySetup.chain !== null,
    chain: registrySetup.chain,
    label: registrySetup.verifierRegistry.label,
    isStub: registrySetup.verifierRegistry.isStub,
  });
});

/** 읽기. 체인이면 RPC 조회, 스텁이면 메모리. (역할 API 와 브라우저 폴백용) */
app.get('/api/revocation/:index', async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index)) {
    res.status(400).json({ error: 'index 가 정수가 아닙니다' });
    return;
  }
  try {
    const { revoked, call } = await registrySetup.verifierRegistry.isRevoked(index);
    res.json({ revoked, call });
  } catch (e) {
    res.status(502).json({ error: `폐기 조회 실패: ${(e as Error).message}` });
  }
});

/** 쓰기 = 분실 신고. 발급기관만 한다. 체인이면 트랜잭션이 블록에 들어갈 때까지 기다린다. */
app.post('/api/revocation/:index', async (req, res) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index)) {
    res.status(400).json({ error: 'index 가 정수가 아닙니다' });
    return;
  }
  try {
    const { call } = await registrySetup.issuerRegistry.revoke(index);
    res.json({ txHash: call.txHash, call });
  } catch (e) {
    res.status(502).json({ error: `폐기 기록 실패: ${(e as Error).message}` });
  }
});

// ── 역할별 API (1 주민센터 · 2 나 · 3 사장님 · 4 국세청) ──────────────
// 각 단계의 내용을 JSON 으로 확인하는 경로. 상세는 server/roleRoutes.ts
registerRoleRoutes(app, { store, residentCenter, taxService, holders: new DemoHolders(), registry: registrySetup });

// ── 프론트 ───────────────────────────────────────────────────────────
async function main(): Promise<void> {
  if (PROD) {
    const dist = path.resolve(here, '..', 'dist');
    app.use(express.static(dist));
    // /, /merchant, /wallet 모두 같은 SPA
    app.use((_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }

  app.listen(PORT, () => {
    console.log(`[trust404] ${PROD ? 'prod' : 'dev'}  http://localhost:${PORT}`);
    console.log(`[trust404] 주민센터 ${residentCenter.did}`);
    console.log(`[trust404] 국세청   ${taxService.did}`);
    console.log(
      `[trust404] 폐기     ${registrySetup.verifierRegistry.label}${registrySetup.chain ? '' : '  (REGISTRY_ADDRESS·RPC_URL·CHAIN_ID 없음 → 메모리 스텁)'}`,
    );
    console.log('[trust404]   /          목업 (오프라인 백업)');
    console.log('[trust404]   /merchant  사장님 화면');
    console.log('[trust404]   /wallet    관객 폰 지갑');
  });
}

void main();
