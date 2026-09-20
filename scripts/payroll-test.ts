import assert from 'node:assert/strict';
import { HolderWallet } from '../src/holder/wallet';
import { generateEd25519KeyPair } from '../src/shared/keys';
import { approveRequest, signJwt, type PayRequest } from '../src/shared/payroll';
import { importJWK, jwtVerify } from 'jose';
const base = process.env.BASE ?? 'http://localhost:3000';
async function call(path: string, auth?: string, body?: unknown) {
  const res = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, data: await res.json() };
}
const room = (await call('/api/app/rooms', undefined, {})).data;
const path = `/api/app/${room.id}`;
const kp = generateEd25519KeyPair();
const wallet = new HolderWallet(kp);
async function issue() {
  const r = await call(path + '/issue', room.worker, { publicJwk: wallet.publicJwk, proof: await signJwt(kp, { room: room.id }, 'urn:trust404:issue', 120) });
  assert.equal(r.status, 200, JSON.stringify(r.data)); return wallet.save(r.data.credential);
}
const old = await issue();
assert.equal(old.selectiveClaims.name, '신혜원');
assert.ok(old.selectiveClaims.photo);
const created = await call(path + '/requests', room.merchant, { amount: 950000, month: '2026-09', phone: '010-0000-1234' });
assert.equal(created.status, 200, JSON.stringify(created.data));
const item = created.data as PayRequest;
const vp = await wallet.present(old.id, ['name'], { nonce: item.request.nonce, audience: item.request.verifier });
const approvalJwt = await approveRequest(kp, item, vp);
const submitPath = path + `/requests/${item.id}/submit`;
assert.equal((await call(path + '/change', room.worker, { field: 'address', value: '경기도 성남시 직접 입력한 주소 12 (가상)' })).status, 400, 'worker cannot revoke');
assert.equal((await call('/api/issuer/revoke', undefined, { statusIndex: old.statusIndex })).status, 403);
assert.equal((await call(`/api/revocation/${old.statusIndex}`, undefined, {})).status, 403);
assert.equal((await call(submitPath, room.merchant, { vp, approvalJwt })).status, 409);
const wrong = await approveRequest(generateEd25519KeyPair(), item, vp);
assert.equal((await call(submitPath, room.worker, { vp, approvalJwt: wrong })).status, 409);
const tampered = await approveRequest(kp, { ...item, signedRequest: item.signedRequest + 'tamper' }, vp);
assert.equal((await call(submitPath, room.worker, { vp, approvalJwt: tampered })).status, 409);
const responses = await Promise.all([call(submitPath, room.worker, { vp, approvalJwt }), call(submitPath, room.worker, { vp, approvalJwt })]);
assert.equal(responses.filter(r => r.status === 200).length, 1, JSON.stringify(responses));
assert.equal((await call(submitPath, room.worker, { vp, approvalJwt })).status, 409);
const state = (await call(path + '/state', room.merchant)).data;
assert.equal(state.requests[0].state, 'accepted');
const json = JSON.stringify(state);
for (const forbidden of ['030412', '서울특별시', 'disclosures', 'privateKey', old.credential]) assert.ok(!json.includes(forbidden), `merchant data leak`);
const receipt = await jwtVerify(state.requests[0].receipt.jwt, await importJWK(state.taxPublicJwk, 'EdDSA'), { audience: 'urn:trust404:merchant' });
assert.equal(receipt.payload.amount, 950000);
assert.equal((await call(path + '/change', room.admin, { field: 'address', value: '경기도 성남시 직접 입력한 주소 12 (가상)' })).status, 200);
const second = (await call(path + '/requests', room.merchant, { amount: 1050000, month: '2026-10', phone: '01000001234' })).data as PayRequest;
const oldVp = await wallet.present(old.id, ['name'], { nonce: second.request.nonce, audience: second.request.verifier });
const rejected = await call(path + `/requests/${second.id}/submit`, room.worker, { vp: oldVp, approvalJwt: await approveRequest(kp, second, oldVp) });
assert.equal(rejected.status, 422);
assert.equal(rejected.data.code, 'VC_REVOKED');
assert.equal(typeof rejected.data.isStub, 'boolean');
assert.ok(rejected.data.checks.some((c: { id: string; ok: boolean }) => c.id === 'revocation' && !c.ok));
const fresh = await issue();
assert.notEqual(fresh.statusIndex, old.statusIndex);
assert.ok(String(fresh.selectiveClaims.address).includes('성남'));
const freshVp = await wallet.present(fresh.id, ['name'], { nonce: second.request.nonce, audience: second.request.verifier });
assert.equal((await call(path + `/requests/${second.id}/submit`, room.worker, { vp: freshVp, approvalJwt: await approveRequest(kp, second, freshVp) })).status, 200);
console.log('PASS: issuance, selective disclosure, receipt signature, role authorization, approval tampering, wrong key, concurrent replay, revocation, reissue, merchant privacy');
const correctionItem = (await call(path + '/requests', room.merchant, { amount: 900000, month: '2026-11', phone: '01000001234' })).data as PayRequest;
const correctionPath = path + `/requests/${correctionItem.id}/correction`;
assert.equal((await call(correctionPath, room.merchant, { message: 'unauthorized' })).status, 409);
assert.equal((await call(correctionPath, room.worker, { message: 'x'.repeat(501) })).status, 409);
assert.equal((await call(correctionPath, room.worker, { message: { invalid: true } })).status, 409);
const correctionMessage = '추가 근무 3시간이 누락됐어요.\n확인 부탁드려요.';
assert.equal((await call(correctionPath, room.worker, { message: correctionMessage })).status, 200);
const corrected = (await call(path + '/state', room.merchant)).data.requests.find((r: PayRequest) => r.id === correctionItem.id);
assert.equal(corrected.correctionMessage, correctionMessage);
assert.equal(corrected.state, 'correction');
assert.equal((await call(correctionPath, room.worker, { message: 'overwrite' })).status, 409);
const correctedVp = await wallet.present(fresh.id, ['name'], { nonce: correctionItem.request.nonce, audience: correctionItem.request.verifier });
assert.equal((await call(path + `/requests/${correctionItem.id}/submit`, room.worker, { vp: correctedVp, approvalJwt: await approveRequest(kp, correctionItem, correctedVp) })).status, 409);
console.log('PASS: correction message delivery, role authorization, length/type checks, terminal correction state');

assert.equal(fresh.selectiveClaims.address, '경기도 성남시 직접 입력한 주소 12 (가상)');
assert.equal((await call(path + '/change', room.admin, { field: 'name', value: ' ' })).status, 400);
assert.equal((await call(path + '/change', room.admin, { field: 'name', value: '새이름' })).status, 200);
const renamed = await issue();
assert.equal(renamed.selectiveClaims.name, '새이름');
console.log('PASS: custom address/name reissue and empty input rejection');
const historyState = (await call(path + '/state', room.worker)).data;
assert.equal(historyState.revocations.length, 2);
assert.equal(historyState.revocations[0].reason, '이름 변경');
assert.equal(historyState.revocations[1].index, old.statusIndex);
assert.equal((await call(path + `/revocations/${old.statusIndex}`, room.worker)).data.revoked, true);
assert.equal((await call(path + `/revocations/${old.statusIndex}`, room.merchant)).status, 400);
assert.equal((await call(path + `/revocations/${renamed.statusIndex}`, room.worker)).status, 400);
assert.equal((await call(path + '/state', room.merchant)).data.revocations, undefined);
console.log('PASS: revocation history, current status query and role isolation');

// A lost response/local VC cannot be downloaded from a server cache.
const replacement = await issue();
assert.notEqual(replacement.credential, renamed.credential);
assert.notEqual(replacement.statusIndex, renamed.statusIndex);
assert.equal((await call(path + '/revocations/' + renamed.statusIndex, room.worker)).data.revoked, true);
const workerState = (await call(path + '/state', room.worker)).data;
assert.equal(workerState.statusIndex, replacement.statusIndex);
assert.ok(!JSON.stringify(workerState).includes(replacement.credential));
assert.equal((await call('/api/issuer/issue', undefined, {})).status, 403);
console.log('PASS: replacement issuance revokes prior VC; no cached credential in state; legacy server wallet disabled');

// Real signatures with a device clock ahead/behind the server.
const { SignJWT, base64url } = await import('jose');
const skewRoom = (await call('/api/app/rooms', undefined, {})).data;
const signingKey = await importJWK({ ...wallet.publicJwk, d: base64url.encode(kp.privateKey) }, 'EdDSA');
async function issueWithSkew(seconds: number) {
  const issuedAt = Math.floor(Date.now() / 1000) + seconds;
  const proof = await new SignJWT({ room: skewRoom.id }).setProtectedHeader({ alg: 'EdDSA' })
    .setAudience('urn:trust404:issue').setIssuedAt(issuedAt).setExpirationTime(issuedAt + 120).sign(signingKey);
  return call('/api/app/' + skewRoom.id + '/issue', skewRoom.worker, { publicJwk: wallet.publicJwk, proof });
}
assert.equal((await issueWithSkew(180)).status, 400);
assert.equal((await issueWithSkew(-300)).status, 400);
assert.equal((await issueWithSkew(30)).status, 200);
console.log('PASS: 30-second clock skew accepted; excessive future and expired proofs rejected');

assert.equal((await call(path + '/change-request', room.merchant, { field: 'address', value: '새집 (가상)' })).status, 400);
assert.equal((await call(path + '/change-request', room.worker, { field: 'address', value: '승진 후 이사한 집 (가상)' })).status, 200);
const october = (await call(path + '/requests', room.merchant, { amount: 1500000, month: '2026-10', phone: '01000001234' })).data as PayRequest;
const staleVp = await wallet.present(replacement.id, ['name'], { nonce: october.request.nonce, audience: october.request.verifier });
assert.equal((await call(path + '/requests/' + october.id + '/submit', room.worker, { vp: staleVp, approvalJwt: await approveRequest(kp, october, staleVp) })).status, 422);
const moved = await issue();
assert.equal(moved.selectiveClaims.address, '승진 후 이사한 집 (가상)');
const movedVp = await wallet.present(moved.id, ['name'], { nonce: october.request.nonce, audience: october.request.verifier });
assert.equal((await call(path + '/requests/' + october.id + '/submit', room.worker, { vp: movedVp, approvalJwt: await approveRequest(kp, october, movedVp) })).status, 200);
console.log('PASS: worker change request, merchant denied, old VC rejected and replacement accepted for October');
