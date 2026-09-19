/**
 * 역할별 API 를 1 → 4 순서로 부르며 각 단계의 내용을 터미널에 찍는다.
 *
 *   npm run demo:api
 *   NAME=홍길동 BIRTH=2001-03-14 RRN=010314-3000000 npm run demo:api    # 번호를 직접 찍어 발급
 *   MERCHANT=<merchantId> npm run demo:api                                # 사장님 화면(/merchant) 목록에도 뜨게
 *   BASE=https://... npm run demo:api                                     # 배포 주소 상대로
 */
const BASE = process.env.BASE ?? 'http://localhost:3000';

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`);
  return JSON.parse(text) as T;
}

/** 긴 문자열(raw JWT·JWE)은 앞부분만 보여 준다. 내용 확인이 목적이지 토큰 덤프가 아니다. */
function pretty(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, v: unknown) => (typeof v === 'string' && v.length > 96 ? `${v.slice(0, 64)}… (${v.length}자)` : v),
    2,
  );
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`);
}

interface Issued {
  holderId: string;
  plaintextRrnInCredential: boolean;
}
interface Presented {
  sessionId: string;
}
interface Verified {
  ok: boolean;
  summary: { label: string; ok: boolean }[];
}
interface Opened {
  opened: boolean;
}
interface Unsealed {
  rrn: string;
}

async function main(): Promise<void> {
  console.log(`서버: ${BASE}`);

  const subject: Record<string, string> = {};
  if (process.env.NAME) subject.name = process.env.NAME;
  if (process.env.BIRTH) subject.birthDate = process.env.BIRTH;
  if (process.env.RRN) subject.rrn = process.env.RRN;

  section('1. 주민센터 (Issuer)   POST /api/issuer/issue');
  const issued = await call<Issued>('/api/issuer/issue', { subject });
  console.log(pretty(issued));

  section(`2. 나 (Holder)   GET /api/holder/${issued.holderId}`);
  console.log(pretty(await call(`/api/holder/${issued.holderId}`)));

  section(`3-1. 나 → 사장님   POST /api/holder/${issued.holderId}/present`);
  const presented = await call<Presented>(`/api/holder/${issued.holderId}/present`, {
    ...(process.env.MERCHANT ? { merchantId: process.env.MERCHANT } : {}),
  });
  console.log(pretty(presented));

  section(`3-2. 사장님 (Verifier)   GET /api/verifier/${presented.sessionId}`);
  const verified = await call<Verified>(`/api/verifier/${presented.sessionId}`);
  console.log(pretty(verified));

  section(`3-3. 사장님 [열어 보기]   POST /api/verifier/${presented.sessionId}/open`);
  const opened = await call<Opened>(`/api/verifier/${presented.sessionId}/open`, {});
  console.log(pretty(opened));

  section('4. 국세청   POST /api/tax/unseal');
  const unsealed = await call<Unsealed>('/api/tax/unseal', { sessionId: presented.sessionId });
  console.log(pretty(unsealed));

  section('요약');
  const rows: [string, boolean][] = [
    ['1 발급된 VC 에 평문 주민번호 없음', !issued.plaintextRrnInCredential],
    ['3 사장님 검증 통과 (4줄 전부 ✓)', verified.ok && verified.summary.every((g) => g.ok)],
    ['3 사장님은 봉인을 못 엶', !opened.opened],
    ['4 국세청은 봉인을 엶', /^\d{6}-\d{7}$/.test(unsealed.rrn)],
  ];
  for (const [label, ok] of rows) console.log(`  ${ok ? '✓' : '✕'} ${label}`);
  if (!rows.every(([, ok]) => ok)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error('\n실패:', (error as Error).message);
  process.exitCode = 1;
});
