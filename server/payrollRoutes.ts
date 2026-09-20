import type { ChainCall } from '../src/shared/revocation';
import type { Express, Request } from 'express';
import { randomBytes } from 'node:crypto';
import { importJWK, jwtVerify, type JWK } from 'jose';
import { residentCenter, taxService } from './authorities';
import type { RegistrySetup } from './chain';
import { generateEd25519KeyPair, publicJwkFromEd25519 } from '../src/shared/keys';
import { sha256Base64Url } from '../src/shared/crypto';
import { EmployerVerifier } from '../src/verifier/employer';
import { createPresentationRequest } from '../src/verifier/request';
import { VCT_RESIDENT_ID } from '../src/shared/schema';
import { TAX_AUDIENCE, requestHash, signJwt, type PayRequest } from '../src/shared/payroll';
import type { ResidentIdSubject } from '../src/shared/types';

const token = () => randomBytes(24).toString('hex');
interface Room {
  id: string; merchant: string; worker: string; admin: string; created: number;
  jwk?: JWK; issuance?: { statusIndex: number; expiresAt: number }; oldIndex?: number;
  changed: boolean; busy: boolean; subject: ResidentIdSubject;
  requests: PayRequest[]; chainCall?: unknown; revocations?: { index: number; reason: string; call: ChainCall }[];
}
export function registerPayrollRoutes(app: Express, registry: RegistrySetup) {
  const rooms = new Map<string, Room>();
  const taxSigning = generateEd25519KeyPair();
  const verifier = new EmployerVerifier();
  function roomFor(req: Request, role?: 'worker' | 'merchant' | 'admin') {
    const room = rooms.get(String(req.params.room));
    const bearer = req.headers.authorization?.replace(/^Bearer /, '');
    if (!room || Date.now() - room.created > 24 * 3600_000) throw new Error('데모 세션이 만료되었습니다. 새 데모를 시작하세요.');
    if (role ? bearer !== room[role] : ![room.worker, room.merchant, room.admin].includes(bearer ?? '')) throw new Error('이 역할의 접근 권한이 없습니다.');
    return room;
  }
  app.post('/api/app/rooms', (_req, res) => {
    for (const [id, r] of rooms) if (Date.now() - r.created > 24 * 3600_000) rooms.delete(id);
    if (rooms.size >= 200) { res.status(429).json({ error: '데모 세션 한도에 도달했습니다.' }); return; }
    const room: Room = { id: token(), merchant: token(), worker: token(), admin: token(), created: Date.now(), changed: false, busy: false,
      subject: { name: '신혜원', birthDate: '2003-04-12', address: '서울특별시 성북구 대학로 24 (가상)', rrn: '030412-4000000', photo: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4MCAxMDAiPjxyZWN0IHdpZHRoPSI4MCIgaGVpZ2h0PSIxMDAiIGZpbGw9IiNkYmU1ZjEiLz48Y2lyY2xlIGN4PSI0MCIgY3k9IjM1IiByPSIxOCIgZmlsbD0iIzhjYTFjMCIvPjxwYXRoIGQ9Ik0xMCAxMDB2LTE1YTMwIDMwIDAgMCAxIDYwIDB2MTUiIGZpbGw9IiM4Y2ExYzAiLz48L3N2Zz4=', documentIssuedOn: new Date().toISOString().slice(0,10), issuingAuthority: '모의 성북구 주민센터' }, requests: [] };
    rooms.set(room.id, room);
    res.json({ id: room.id, merchant: room.merchant, worker: room.worker, admin: room.admin });
  });
  app.get('/api/app/:room/state', (req, res) => {
    try {
      const room = roomFor(req);
      const worker = req.headers.authorization === `Bearer ${room.worker}`;
      res.setHeader('Cache-Control', 'no-store');
      res.json({ requests: room.requests.map(({ workerKey: _key, ...r }) => r), issued: !!room.issuance,
        changed: room.changed, name: room.subject.name, phone: '010-0000-1234',
        ...(worker ? { subject: { ...room.subject, rrn: '030412-4******' }, statusIndex: room.issuance?.statusIndex, oldIndex: room.oldIndex, chainCall: room.chainCall, revocations: room.revocations ?? [] } : {}),
        issuerDid: residentCenter.did, taxPublicJwk: publicJwkFromEd25519(taxSigning.publicKey),
        registry: { label: registry.verifierRegistry.label, isStub: registry.verifierRegistry.isStub } });
    } catch (e) { res.status(403).json({ error: (e as Error).message }); }
  });
  app.get('/api/app/:room/revocations/:index', async (req, res) => {
    try {
      const room = roomFor(req, 'worker');
      const index = Number(req.params.index);
      if (!room.revocations?.some(r => r.index === index)) throw new Error('이 지갑의 폐기 기록이 아닙니다.');
      const result = await registry.verifierRegistry.isRevoked(index);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ revoked: result.revoked, checkedAt: result.call.at });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });
  app.post('/api/app/:room/issue', async (req, res) => {
    let locked: Room | undefined;
    try {
      const room = roomFor(req, 'worker');
      if (room.busy) throw new Error('기관 처리 중입니다. 잠시 후 다시 시도하세요.');
      const jwk = req.body.publicJwk as JWK;
      if (jwk?.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || jwk.d) throw new Error('공개키만 제출해야 합니다.');
      const proof = await jwtVerify(req.body.proof, await importJWK(jwk, 'EdDSA'), { audience: 'urn:trust404:issue', algorithms: ['EdDSA'], maxTokenAge: '2m', clockTolerance: 60 });
      if (proof.payload.room !== room.id) throw new Error('발급 요청 불일치');
      if (room.jwk && room.jwk.x !== jwk.x) throw new Error('다른 지갑에 연결된 데모입니다. 새 데모를 시작하세요.');
      room.busy = true; locked = room;
      room.jwk = { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
      // Retain only revocation metadata; the issued VC is delivered once to the wallet.
      // A retry/lost local copy creates a replacement, never retrieves a server copy.
      if (room.issuance && !room.changed) {
        const result = await registry.issuerRegistry.revoke(room.issuance.statusIndex);
        room.oldIndex = room.issuance.statusIndex; room.chainCall = result.call;
        (room.revocations ??= []).unshift({ index: room.oldIndex, reason: '지갑 증명 재발급', call: result.call });
        room.changed = true;
      }
      const issued = await residentCenter.issueResidentId(room.subject, { holderPublicJwk: room.jwk, taxAuthorityPublicJwk: taxService.publicJwk, ttlSeconds: 86400 });
      room.issuance = { statusIndex: issued.statusIndex, expiresAt: issued.expiresAt };
      room.changed = false;
      res.setHeader('Cache-Control', 'no-store');
      res.json(issued);
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
    finally { if (locked) locked.busy = false; }
  });
  app.post(['/api/app/:room/change', '/api/app/:room/change-request'], async (req, res) => {
    let locked: Room | undefined;
    try {
      // Worker requests are automatically approved by the simulated authority in this demo.
      const room = roomFor(req, req.path.endsWith('/change-request') ? 'worker' : 'admin');
      if (!room.issuance || room.changed || room.busy) throw new Error('유효한 증명서 발급 후 변경할 수 있습니다.');
      if (!['name', 'address'].includes(req.body.field)) throw new Error('변경 항목을 선택하세요.');
      const value = req.body.value;
      const field = req.body.field as 'name' | 'address';
      if (typeof value !== 'string' || !value.trim() || value.length > (field === 'name' ? 50 : 200) || /[\x00-\x1F\x7F]/.test(value)) throw new Error('변경할 정보를 올바르게 입력해주세요.');
      if (value.trim() === room.subject[field]) throw new Error('현재 정보와 다른 내용을 입력해주세요.');
      room.busy = true; locked = room;
      const result = await registry.issuerRegistry.revoke(room.issuance.statusIndex);
      room.oldIndex = room.issuance.statusIndex; room.chainCall = result.call;
      (room.revocations ??= []).unshift({ index: room.oldIndex, reason: field === 'name' ? '이름 변경' : '주소 변경', call: result.call });
      room.subject[field] = value.trim();
      room.changed = true;
      res.json({ ok: true, call: result.call });
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
    finally { if (locked) locked.busy = false; }
  });
  app.post('/api/app/:room/requests', async (req, res) => {
    try {
      const room = roomFor(req, 'merchant');
      const { amount, month, phone } = req.body;
      if (!room.jwk) throw new Error('먼저 근로자 화면에서 신원증명을 발급하세요.');
      if (String(phone).replace(/\D/g, '') !== '01000001234') throw new Error('데모 근로자 번호는 010-0000-1234입니다.');
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000_000 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('지급 월과 금액을 확인하세요.');
      if (room.requests.length >= 50) throw new Error('요청은 데모당 50건까지 만들 수 있습니다.');
      const request = createPresentationRequest({ verifier: TAX_AUDIENCE, purpose: '카페 월 급여 소득 신고 확인', requested: ['name', 'rrn_sealed'], ttlSeconds: 3600 });
      const item: PayRequest = { id: token().slice(0, 12), business: '카페 온유', workerName: room.subject.name, amount, month, phone: '010-0000-1234', workerKey: room.jwk.x!, request, signedRequest: '', state: 'pending', createdAt: new Date().toISOString() };
      item.signedRequest = await signJwt(taxSigning, { request_id: item.id, business: item.business, month, amount, worker_key: item.workerKey, nonce: request.nonce, requested: request.requested }, 'urn:trust404:worker', 3600);
      room.requests.unshift(item);
      res.json(item);
    } catch (e) { res.status(400).json({ error: (e as Error).message }); }
  });
  app.post('/api/app/:room/requests/:id/correction', (req, res) => {
    try {
      const room = roomFor(req, 'worker');
      const item = room.requests.find(r => r.id === req.params.id);
      if (!item || item.state !== 'pending' || room.busy) throw new Error('정정할 수 없는 요청입니다.');
      const message = req.body.message ?? '';
      if (typeof message !== 'string' || message.length > 500) throw new Error('정정 메시지는 500자 이내로 입력해주세요.');
      item.correctionMessage = message.trim();
      item.state = 'correction'; res.json({ ok: true });
    } catch (e) { res.status(409).json({ error: (e as Error).message }); }
  });
  app.post('/api/app/:room/requests/:id/submit', async (req, res) => {
    let locked: Room | undefined;
    try {
      const room = roomFor(req, 'worker');
      const item = room.requests.find(r => r.id === req.params.id);
      if (!item || item.state !== 'pending') throw new Error('이미 처리되었거나 유효하지 않은 요청입니다.');
      if (room.busy) throw new Error('다른 요청을 처리 중입니다.');
      room.busy = true; locked = room;
      if (Date.parse(item.request.expiresAt) <= Date.now()) throw new Error('요청이 만료되었습니다. 사업주에게 새 요청을 받으세요.');
      const { vp, approvalJwt } = req.body;
      if (typeof vp !== 'string' || typeof approvalJwt !== 'string') throw new Error('증명과 승인 서명이 필요합니다.');
      const report = await verifier.verify(vp, { trustedIssuers: [residentCenter.did], expectedVct: VCT_RESIDENT_ID, request: item.request, requireKeyBinding: true, revocationRegistry: registry.verifierRegistry, skewSeconds: 60 });
      if (!report.ok || !report.request?.satisfied) { const revoked = report.chainCall?.result === 'true'; const record = revoked ? room.revocations?.find(r => r.index === report.chainCall?.argument) : undefined; res.status(422).json({ error: report.checks.filter(c => !c.ok).map(c => c.detail).join(' / ') || '필수 정보 누락', checks: report.checks, ...(revoked ? { code: 'VC_REVOKED', isStub: registry.verifierRegistry.isStub, explorerUrl: !registry.verifierRegistry.isStub ? record?.call.explorerUrl : undefined } : {}) }); return; }
      const payload = report.payload!;
      const jwk = (payload.cnf as { jwk: JWK }).jwk;
      if (jwk.x !== item.workerKey) throw new Error('요청받은 근로자의 지갑이 아닙니다.');
      const approval = await jwtVerify(approvalJwt, await importJWK(jwk, 'EdDSA'), { audience: TAX_AUDIENCE, algorithms: ['EdDSA'], maxTokenAge: '10m', clockTolerance: 60 });
      if (approval.payload.request_id !== item.id || approval.payload.request_hash !== requestHash(item.signedRequest) || approval.payload.presentation_hash !== sha256Base64Url(vp) || approval.payload.decision !== 'approve') throw new Error('승인한 신고 내용 또는 제출 증명과 일치하지 않습니다.');
      if (report.audit.disclosed.some(c => c.key !== 'name')) throw new Error('이 신고에는 이름 외의 공개 조각을 받지 않습니다.');
      const opened = await taxService.unsealRrn(String(payload.rrn_sealed));
      if (!opened.ok) throw new Error('세무정보 봉인 검증 실패');
      const name = String(report.audit.disclosed.find(c => c.key === 'name')?.value ?? '');
      const acceptedAt = new Date().toISOString();
      const receiptId = `DEMO-${item.id.toUpperCase()}`;
      const jwt = await signJwt(taxSigning, { receipt_id: receiptId, request_id: item.id, request_hash: requestHash(item.signedRequest), name, amount: item.amount, month: item.month, accepted_at: acceptedAt }, 'urn:trust404:merchant', 86400);
      item.receipt = { id: receiptId, name, acceptedAt, jwt };
      // No VP, plaintext RRN, or approval token is retained in the merchant-facing record.
      item.checks = report.checks.map(({ id, label, ok }) => ({ id, label, ok, detail: ok ? '검증 통과' : '검증 실패' }));
      item.checks.push({ id: 'approval', label: '지급 내역 승인 서명', ok: true, detail: '요청 및 제출 증명의 해시 일치' });
      item.state = 'accepted';
      res.json({ receipt: item.receipt, checks: item.checks, chainCall: report.chainCall });
    } catch (e) { res.status(409).json({ error: (e as Error).message }); }
    finally { if (locked) locked.busy = false; }
  });
}
