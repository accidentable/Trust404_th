import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { get, set } from 'idb-keyval';
import { importJWK, jwtVerify, type JWK } from 'jose';
import { HolderWallet } from '../../holder/wallet';
import { ed25519KeyPairFromSeed, generateEd25519KeyPair, type Ed25519KeyPair } from '../../shared/keys';
import { approveRequest, signJwt, type PayRequest } from '../../shared/payroll';
import type { StoredCredential, VerificationCheck } from '../../shared/types';
import './pay-app.css';
import { PayReview } from './PayReview';

type Role = 'worker' | 'merchant';
type Tab = 'home' | 'identity' | 'requests' | 'settings';
interface Session { id: string; worker?: string; merchant?: string; admin?: string }
interface State {
  revocations?: { index: number; reason: string; call: { at: number; result: string; txHash?: string; explorerUrl?: string } }[];
  requests: PayRequest[]; issued: boolean; changed: boolean; name: string; phone: string;
  subject?: { name: string; address: string; birthDate: string; rrn: string };
  statusIndex?: number; issuerDid: string; taxPublicJwk: JWK; oldIndex?: number;
  registry: { label: string; isStub: boolean }; chainCall?: { txHash?: string; explorerUrl?: string; result: string };
}
const labels = { pending: '확인 대기', correction: '정정 요청', accepted: '접수 완료' };
const money = (v: number) => new Intl.NumberFormat('ko-KR').format(v);
function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7v10H4V10"/><path d="M9 21v-8h6v8"/></>,
    identity: <><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M6 16c0-3 6-3 6 0m3-7h3m-3 4h3"/></>,
    requests: <><rect x="5" y="3" width="14" height="18" rx="3"/><path d="M9 8h6m-6 4h6m-6 4h3"/></>,
    settings: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3"/></>,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6Z"/><path d="m8 12 3 3 5-6"/></>,
    arrow: <path d="m9 5 7 7-7 7"/>,
    bell: <><path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4Zm5 3h4"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.shield}</svg>;
}
async function api<T>(path: string, token?: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error(data.error || '요청을 처리하지 못했습니다.'), { code: data.code, isStub: data.isStub, explorerUrl: data.explorerUrl });
  return data;
}
let creating: Promise<Session> | undefined;
async function loadSession(): Promise<Session> {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.has('room') && hash.has('token')) {
    const role = hash.get('role') === 'merchant' ? 'merchant' : 'worker';
    const s = { id: hash.get('room')!, [role]: hash.get('token')! };
    sessionStorage.setItem('trust404.app.session', JSON.stringify(s));
    history.replaceState(null, '', `${location.pathname}?role=${role}`); return s;
  }
  const saved = sessionStorage.getItem('trust404.app.session');
  if (saved) return JSON.parse(saved);
  creating ??= api<Session>('/api/app/rooms', undefined, {});
  const s = await creating; sessionStorage.setItem('trust404.app.session', JSON.stringify(s)); return s;
}

export function PayApp({ landing = false }: { landing?: boolean }) {
  const [role, setRole] = useState<Role>((new URLSearchParams(location.hash.slice(1)).get('role') ?? new URLSearchParams(location.search).get('role')) === 'merchant' || location.pathname === '/merchant' ? 'merchant' : 'worker');
  const [tab, setTab] = useState<Tab>('home');
  const [session, setSession] = useState<Session>();
  const [state, setState] = useState<State>();
  const [credential, setCredential] = useState<StoredCredential>();
  const [rejectedVc, setRejectedVc] = useState<{ isStub: boolean; explorerUrl?: string }>();
  const [selected, setSelected] = useState<string>();
  const [composer, setComposer] = useState(false);
  const [amount, setAmount] = useState('950000');
  const [month, setMonth] = useState('2026-09');
  const [phone, setPhone] = useState('010-0000-1234');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tests, setTests] = useState<string>('');
  const [checks, setChecks] = useState<VerificationCheck[]>([]);
  const [share, setShare] = useState('');
  const [revocationChecks, setRevocationChecks] = useState<Record<number, string>>({});
  const [changeField, setChangeField] = useState<'name' | 'address'>('address');
  const [changeValue, setChangeValue] = useState('');
  const changeSection = useRef<HTMLHeadingElement | null>(null);
  const jumpToChange = useRef(false);
  const scrollArea = useRef<HTMLDivElement | null>(null);
  useEffect(() => { scrollArea.current?.scrollTo({ top: 0 }); }, [tab, role, selected, composer]);
  useEffect(() => {
    if (tab === 'settings' && jumpToChange.current) {
      jumpToChange.current = false;
      changeSection.current?.scrollIntoView({ block: 'start' });
      changeSection.current?.focus({ preventScroll: true });
    }
  }, [tab]);
  const wallet = useRef<HolderWallet | undefined>(undefined);
  const key = useRef<Ed25519KeyPair | undefined>(undefined);
  const previous = useRef<StoredCredential | undefined>(undefined);
  const lastSubmission = useRef<{ id: string; vp: string; approvalJwt: string } | undefined>(undefined);
  const base = session ? `/api/app/${session.id}` : '';
  const refresh = useCallback(async () => {
    if (!session) return;
    const data = await api<State>(`/api/app/${session.id}/state`, session[role]); setState(data);
  }, [session, role]);
  useEffect(() => { void loadSession().then(setSession).catch(e => setError(e.message)); }, []);
  useEffect(() => {
    if (!session?.worker || role !== 'worker') return;
    let active = true;
    void (async () => {
      const slot = `trust404.app.${session.id}`;
      const seed = await get<number[]>(`${slot}.seed`);
      const kp = seed ? ed25519KeyPairFromSeed(Uint8Array.from(seed)) : generateEd25519KeyPair();
      if (!seed) await set(`${slot}.seed`, [...kp.privateKey]);
      const w = new HolderWallet(kp);
      const raw = await get<string>(`${slot}.vc`);
      const old = await get<string>(`${slot}.old`);
      const saved = raw ? await w.save(raw) : undefined;
      const oldSaved = old ? await w.save(old) : undefined;
      if (active) { key.current = kp; wallet.current = w; previous.current = oldSaved; setCredential(saved); }
    })().catch(e => setError(e.message));
    return () => { active = false; };
  }, [session, role]);
  useEffect(() => {
    void refresh().catch(e => setError(e.message));
    const timer = setInterval(() => void refresh().catch(e => setError(e.message)), 2500);
    return () => clearInterval(timer);
  }, [refresh]);
  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function issue() {
    if (!session?.worker || !key.current || !wallet.current) throw new Error('지갑을 준비하고 있습니다.');
    const proof = await signJwt(key.current, { room: session.id }, 'urn:trust404:issue', 120);
    const issued = await api<{ credential: string }>(`${base}/issue`, session.worker, { publicJwk: wallet.current.publicJwk, proof });
    if (credential && credential.credential !== issued.credential) { previous.current = credential; await set(`trust404.app.${session.id}.old`, credential.credential); }
    const saved = await wallet.current.save(issued.credential);
    await set(`trust404.app.${session.id}.vc`, issued.credential); setCredential(saved); setNotice('신원증명을 지갑에 안전하게 저장했어요.');
  }
  async function submit(item: PayRequest, mode?: 'old' | 'tamper') {
    const cred = mode === 'old' ? previous.current ?? credential : credential;
    if (!cred || !wallet.current || !key.current || !state || !session) throw new Error('먼저 신원증명을 발급하세요.');
    const verified = await jwtVerify(item.signedRequest, await importJWK(state.taxPublicJwk, 'EdDSA'), { audience: 'urn:trust404:worker', algorithms: ['EdDSA'], clockTolerance: 60 });
    const p = verified.payload;
    if (p.amount !== item.amount || p.month !== item.month || p.business !== item.business || p.nonce !== item.request.nonce || p.request_id !== item.id || p.worker_key !== wallet.current.publicJwk.x) throw new Error('요청 서명이 화면의 지급 내역과 일치하지 않습니다.');
    const vp = await wallet.current.present(cred.id, ['name'], { nonce: item.request.nonce, audience: item.request.verifier });
    const approvalJwt = await approveRequest(key.current, mode === 'tamper' ? { ...item, signedRequest: `${item.signedRequest}changed-amount` } : item, vp);
    let response: { checks: VerificationCheck[] };
    try { response = await api<{ checks: VerificationCheck[] }>(`${base}/requests/${item.id}/submit`, session.worker, { vp, approvalJwt }); }
    catch (e) { const failure = e as Error & { code?: string; isStub?: boolean; explorerUrl?: string }; if (failure.code === 'VC_REVOKED') { setRejectedVc({ isStub: !!failure.isStub, explorerUrl: failure.explorerUrl }); return; } throw e; }
    lastSubmission.current = { id: item.id, vp, approvalJwt };
    setChecks(response.checks); setNotice('확인한 급여 내역으로 모의 접수가 완료됐어요.');
  }
  async function attack(mode: 'old' | 'tamper' | 'replay') {
    setTests('검증 중…');
    try {
      if (mode === 'replay') {
        if (!lastSubmission.current) throw new Error('먼저 정상 접수를 한 번 완료하세요.');
        const b = lastSubmission.current;
        await api(`${base}/requests/${b.id}/submit`, session?.worker, { vp: b.vp, approvalJwt: b.approvalJwt });
      } else {
        const item = state?.requests.find(r => r.state === 'pending');
        if (!item) throw new Error('사업주 화면에서 새 요청을 만들어 주세요.');
        if (mode === 'old' && !previous.current && !state?.changed) throw new Error('기관 정보 변경으로 기존 VC를 폐기한 뒤 실행하세요.');
        await submit(item, mode);
      }
      setTests('주의: 요청이 통과했습니다.');
    } catch (e) { setTests((e as Error).message); }
  }
  const pending = state?.requests.filter(r => r.state === 'pending') ?? [];
  const item = state?.requests.find(r => r.id === selected);
  const nav = (next: Tab) => { setRejectedVc(undefined); setTab(next); setSelected(undefined); setComposer(false); setError(''); setNotice(''); };
  const valid = credential && state?.statusIndex === credential.statusIndex && !state.changed && credential.expiresAt > Date.now() / 1000;
  function IdentityCard() {
    return <div className={`identity-card ${!valid ? 'unissued' : ''}`}>
      <div className="card-top"><span>대한민국 · DEMO ID</span><Icon name="shield" size={25}/></div>
      {valid ? <div className="card-person"><div><small>모바일 신원증명</small><h2>{String(credential.selectiveClaims.name)}</h2><p>2003. 04. 12.</p></div><div className="portrait">{credential.selectiveClaims.photo ? <img src={String(credential.selectiveClaims.photo)} alt="가상 인물의 신원증명 사진"/> : <Icon name="identity" size={38}/>}</div></div> : <div className="card-issue-action"><button disabled={busy} onClick={() => void run(issue)}>{busy ? '발급 중…' : credential ? '재발급하기' : '신원 증명 발급하기'}<Icon name="arrow" size={18}/></button></div>}
      <div className="card-bottom"><span>{valid ? '● 유효한 신원증명' : credential ? '● 재발급 필요' : '● 발급 준비'}</span><span>주민센터</span></div>
    </div>;
  }
  function Requests() {
    return <div className="request-list">{state?.requests.length ? state.requests.map(r => <button key={r.id} className="request-row" onClick={() => { setSelected(r.id); setChecks([]); }}><span className="row-icon"><Icon name={r.state === 'accepted' ? 'check' : 'requests'}/></span><span className="row-main"><strong>{role === 'merchant' && <>{r.receipt?.name ?? r.workerName ?? state.name} · </>}{r.month.split('-')[1]}월 급여 확인</strong><small>{role === 'worker' ? r.business : r.receipt ? '접수 완료' : '요청 당시 정보'} · {money(r.amount)}원</small></span><span className={`status ${r.state}`}>{labels[r.state]}</span><Icon name="arrow" size={14}/></button>) : <div className="empty"><Icon name="requests" size={34}/><h3>아직 받은 요청이 없어요</h3><p>{role === 'worker' ? '사업주가 급여 확인을 요청하면 여기에 알려드려요.' : '첫 급여 신고 요청을 보내보세요.'}</p></div>}</div>;
  }
  return <div className={`pay-app ${landing ? 'landing-app' : 'standalone-app'}`}>{landing && <aside className="app-story"><a href="/" className="app-brand">SabonX <span>02 / IDENTITY</span></a><div><div className="eyebrow">YOUR IDENTITY. YOUR CHOICE.</div><h1>주민등록증,<br/><em>안전하게.</em></h1><p>월급 확인부터 소득 신고까지.</p>{landing && <div className="landing-story-links"><a href="/app">앱 데모 시작 ↗</a><a href="#why">이 서비스를 만든 이유 ↓</a></div>}</div><footer><Icon name="shield"/><span>실제 암호 검증 · 가상 신원정보<br/>정부 기관과 연동되지 않은 해커톤 데모</span></footer></aside>}
    <div className="phone-stage"><div className="phone"><div className="statusbar"><span>9:41</span><div className="island"/><span className="phone-signals">▮▮▮ <span>◔</span> ▰</span></div>
      <div className="app-toolbar"><a href="/" aria-label="랜딩으로 돌아가기">‹</a><strong>SabonX<span>DEMO</span></strong><button aria-label="요청 알림" onClick={() => nav('requests')}><Icon name="bell"/>{pending.length > 0 && <b className="notification-dot"/>}</button></div>
      <div className="phone-scroll" ref={scrollArea}><div className="role-switch" aria-label="데모 역할 선택">{(['worker', 'merchant'] as Role[]).map(r => <button key={r} aria-pressed={role === r} disabled={!session?.[r]} className={role === r ? 'active' : ''} onClick={() => { setRole(r); nav('home'); }}>{r === 'worker' ? '근로자' : '사업주'}</button>)}</div>
        {error && <div className="app-alert error" role="alert">{error}{!state && <button className="secondary" onClick={() => { sessionStorage.removeItem('trust404.app.session'); location.href = '/app'; }}>새 데모 시작</button>}</div>}{notice && <div className="app-alert success" role="status">{notice}</div>}
        {!state && !error && <div className="empty">안전한 데모 공간을 준비하고 있어요…</div>}
        {state && !item && !composer && tab === 'home' && <><header className="page-heading"><p>{role === 'worker' ? '오늘도 수고했어요' : '사장님, 안녕하세요'}</p><h1>{role === 'worker' ? `${state.name}님의 안심 지갑` : '카페 온유의 급여 관리'}</h1></header>
          {role === 'worker' ? <IdentityCard/> : <div className="business-card"><span className="business-symbol">온유<span>coffee & moments</span></span><div><span>이번 달 신고 현황</span><strong>{state.requests.filter(r => r.state === 'accepted').length}<small>건 접수</small></strong><p>신분증 사본 없이 시작하세요.</p></div></div>}
          <div className="quick-actions"><button onClick={() => nav('identity')}><span className="action-icon blue"><Icon name="identity"/></span><strong>{role === 'worker' ? '내 신원증명' : '사업자 정보'}</strong><small>{role === 'worker' ? valid ? '보관된 증명 보기' : '발급 · 업데이트' : '인증된 테스트 사업장'}</small></button><button onClick={() => role === 'merchant' ? setComposer(true) : nav('requests')}><span className="action-icon green"><Icon name={role === 'merchant' ? 'plus' : 'requests'}/></span><strong>{role === 'merchant' ? '급여 신고 요청' : '받은 요청'}</strong><small>{role === 'merchant' ? '근로자에게 확인 요청' : `${pending.length}건의 확인 대기`}</small></button></div>
          {pending.length > 0 && role === 'worker' && <button className="notification-card" onClick={() => { setTab('requests'); setSelected(pending[0]!.id); }}><span className="action-icon blue"><Icon name="bell"/></span><span><strong>급여 확인 요청이 도착했어요</strong><small>내용을 확인하고 안전하게 서명하세요.</small></span><Icon name="arrow" size={16}/></button>}
          <div className="section-title"><h2>최근 활동</h2><button onClick={() => nav('requests')}>전체 보기</button></div><Requests/><div className="privacy-note"><Icon name="lock" size={17}/><span>주민등록번호는 세무 수신자만 열 수 있어요.</span></div></>}
        {state && !item && !composer && tab === 'identity' && <><header className="page-heading"><p>{role === 'worker' ? '내 정보의 주인은 나' : '테스트 사업장'}</p><h1>{role === 'worker' ? '내 신원증명' : '사업자 정보'}</h1></header>{role === 'worker' ? <><IdentityCard/><div className="settings-group"><div><span>발급기관</span><strong>모의 주민센터</strong></div><div><span>주소</span><strong>{credential ? String(credential.selectiveClaims.address) : '발급 후 확인'}</strong></div><div><span>주민등록번호</span><strong>030412-4••••••</strong></div><div><span>증명 발급일</span><strong>{credential ? new Date(credential.issuedAt * 1000).toLocaleDateString('ko-KR') : '—'}</strong></div></div><p className="helper">테스트 기관이 확인한 가상 정보로 발급합니다. 개인키는 이 브라우저 지갑에 보관됩니다.</p>{valid ? session?.worker && <button className="primary" disabled={busy} onClick={() => { jumpToChange.current = true; nav('settings'); }}>이름·주소 변경하기</button> : <button className="primary" disabled={busy} onClick={() => void run(issue)}>{busy ? '발급 중…' : !credential ? '신원증명 발급받기' : '재발급하기'}</button>}{credential && <details className="technical"><summary>DID · 증명서 상세</summary><p>지갑 DID</p><code>{wallet.current?.did}</code><p>폐기 식별자</p><code>{credential.statusIndex}</code><p>보유 항목: 이름, 주소, 생년월일, 사진, 발급일자, 발급기관, 봉인된 주민번호</p><p>주소 · 사진 등은 급여 신고에 전송하지 않습니다.</p></details>}</> : <><div className="settings-group"><div><span>사업장명</span><strong>카페 온유</strong></div><div><span>인증 상태</span><strong className="green-text">테스트 계정 연결됨</strong></div><div><span>업무</span><strong>월 급여 소득 신고</strong></div></div><p className="helper">사업체 실명 확인은 모의 처리입니다. 사업주에게 근로자의 VC 원문과 주민번호를 제공하지 않습니다.</p><button className="primary" onClick={() => setComposer(true)}>급여 신고 요청하기</button></>}</>}
        {state && !item && !composer && tab === 'requests' && <><header className="page-heading"><p>함께 확인하는 급여 내역</p><h1>{role === 'worker' ? '받은 요청' : '보낸 요청'}</h1></header>{role === 'merchant' && <button className="primary" onClick={() => setComposer(true)}>새 급여 요청 만들기</button>}<Requests/></>}
        {composer && <><button className="back-link" onClick={() => setComposer(false)}>‹ 돌아가기</button><header className="page-heading"><p>카페 온유</p><h1>급여 확인을 요청해요</h1></header><form onSubmit={e => { e.preventDefault(); void run(async () => { await api(`${base}/requests`, session?.merchant, { phone, month, amount: Number(amount) }); setComposer(false); setTab('requests'); setNotice('근로자 요청함으로 알림을 보냈어요.'); }); }}><div className="form-group"><label>근로자 휴대전화<input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" required/></label><small>데모 번호 010-0000-1234 · 실제 문자는 발송하지 않아요.</small><label>급여 대상 월<input type="month" value={month} onChange={e => setMonth(e.target.value)} required/></label><label>지급 총액 (원)<input type="number" min="1" max="100000000" value={amount} onChange={e => setAmount(e.target.value)} required/></label></div><div className="info-box"><Icon name="shield"/><p>근로자는 내역을 확인한 뒤 직접 서명해요. 신원정보는 모의 세무기관으로 전달됩니다.</p></div><button className="primary" disabled={busy}>{busy ? '요청 전송 중…' : '확인·서명 요청 보내기'}</button><p className="helper">소득 신고 흐름의 데모입니다. 세액 계산·납부·급여 송금은 수행하지 않습니다.</p></form></>}
        {item && rejectedVc && role === 'worker' && <section className="pay-review revoked-result" aria-label="신원증명 제출 거절"><Icon name="shield" size={42}/><h1>이전 신원증명으로는<br/>제출할 수 없어요</h1><p>폐기된 신원증명이에요.<br/>새 신원증명을 발급받아 다시 제출해주세요.</p><p className="helper">✓ {rejectedVc.isStub ? '로컬 모의 목록' : 'Sepolia'}에서 폐기 상태 확인</p><button className="primary" onClick={() => nav('identity')}>새 신원증명 발급받기</button>{rejectedVc.explorerUrl && <a href={rejectedVc.explorerUrl} target="_blank" rel="noreferrer">Etherscan에서 폐기 기록 보기 ↗</a>}<button className="text-button" onClick={() => nav('requests')}>급여 요청 목록으로</button></section>}
        {item && item.state === 'pending' && role === 'worker' && !rejectedVc && <PayReview key={item.id} item={item} name={state?.name ?? ''} busy={busy} valid={!!valid} onClose={() => setSelected(undefined)} onIdentity={() => nav('identity')} onSubmit={() => void run(() => submit(item))} onCorrection={async message => { await api(`${base}/requests/${item.id}/correction`, session?.worker, { message }); await refresh(); setNotice('사업주에게 정정을 요청했어요.'); }}/>}
        {item && !(item.state === 'pending' && role === 'worker') && <section className="request-result"><button className="back-link" onClick={() => setSelected(undefined)}>‹ 요청 목록</button><header className="page-heading"><p>{role === 'merchant' ? (item.receipt?.name ?? item.workerName ?? state?.name) : item.business}</p><h1>{item.month.split('-')[1]}월 급여 확인</h1></header><div className="amount-card"><span>신고할 지급 총액</span><strong>{money(item.amount)}<small>원</small></strong><span className={`status ${item.state}`}>{labels[item.state]}</span></div><div className="settings-group">{role === 'merchant' && <div><span>근로자</span><strong>{item.receipt?.name ?? item.workerName ?? state?.name}</strong></div>}<div><span>급여 대상 월</span><strong>{item.month}</strong></div><div><span>요청 사업장</span><strong>{item.business}</strong></div><div><span>접수 기관</span><strong>모의 국세청</strong></div></div>
          {item.state === 'pending' && role === 'merchant' && <div className="info-box"><Icon name="bell"/><p>근로자의 확인을 기다리고 있어요. 완료되면 이 화면에 접수 결과가 표시됩니다.</p></div>}
          {item.state === 'correction' && <><div className="info-box"><p>정정 요청을 보냈어요. 사업주는 내용을 확인하고 새로운 급여 요청을 보내주세요.</p></div><div className="correction-note"><strong>근로자가 보낸 메시지</strong>{item.correctionMessage || '별도의 메시지 없이 정정을 요청했어요.'}</div>{role === 'merchant' && <button className="primary" onClick={() => { setAmount(String(item.amount)); setMonth(item.month); setSelected(undefined); setComposer(true); }}>수정한 급여로 새 요청 만들기</button>}</>}
          {item.receipt && <><div className="receipt"><span className="receipt-check"><Icon name="check" size={30}/></span><h2>안전하게 접수했어요</h2><p>지급명세서 접수 완료 · 모의 처리</p><code>{item.receipt.id}</code><small>사업주에게 주민등록번호를 제공하지 않았습니다.</small></div><details className="technical"><summary>서명된 접수증 · 검증 상세</summary>{(checks.length ? checks : item.checks ?? []).map(c => <p key={c.id}>{c.ok ? '✓' : '✕'} {c.label}</p>)}<code>{item.receipt.jwt}</code></details></>}
        </section>}
        {state && !item && !composer && tab === 'settings' && <><header className="page-heading"><p>SabonX · 검증 가능한 데모</p><h1>시연 설정</h1></header><h2 className="section-heading">다른 기기에서 이어보기</h2><p className="helper">링크를 가진 사람이 해당 테스트 역할에 접근합니다. 근로자 링크는 VC 발급 전에 연결하세요.</p><div className="button-pair">{(['worker', 'merchant'] as Role[]).filter(r => session?.[r]).map(r => <button key={r} className="secondary" onClick={() => { const url = `${location.origin}/app#room=${session?.id}&role=${r}&token=${session?.[r]}`; setShare(url); void navigator.clipboard?.writeText(url).catch(() => {}); }}>{r === 'worker' ? '근로자' : '사업주'} 링크 복사</button>)}</div>{share && <textarea className="share-url" readOnly value={share} aria-label="기기 연결 링크"/>}
          {role === 'worker' && session?.worker && <><h2 className="section-heading" ref={changeSection} tabIndex={-1}>이름·주소 변경 요청</h2><p className="helper">변경할 가상 정보를 입력하세요. 데모에서는 모의 주민센터가 요청을 자동 승인해요. 기존 증명 폐기 후 새 증명을 발급받으세요.</p><form className="identity-change" onSubmit={e => { e.preventDefault(); void run(async () => { await api(`${base}/change-request`, session.worker, { field: changeField, value: changeValue }); setChangeValue(''); setNotice('변경 요청 승인 · 기존 증명 폐기 완료. 내 신원증명에서 재발급받으세요.'); }); }}><label>변경 항목<select value={changeField} disabled={busy} onChange={e => { setChangeField(e.target.value as 'name' | 'address'); setChangeValue(''); }}><option value="address">주소</option><option value="name">이름</option></select></label><label>{changeField === 'name' ? '새 이름' : '새 주소'}<input value={changeValue} onChange={e => setChangeValue(e.target.value)} maxLength={changeField === 'name' ? 50 : 200} required disabled={busy} placeholder={changeField === 'name' ? '예: 김서윤 (가상)' : '예: 경기도 성남시 새봄로 12 (가상)'}/></label><button className="primary" disabled={busy || !state.issued || state.changed || !changeValue.trim()}>{busy ? '변경 처리 중…' : '정보 변경 요청하기'}</button></form></>}
          {role === 'worker' && <details className="technical"><summary>시연용 보안 검사</summary><p>변조·폐기된 증명·승인 재사용을 차단하는지 확인하는 심사용 기능이에요.</p><div className="security-buttons"><button disabled={busy} onClick={() => void run(() => attack('tamper'))}>승인 내역 바꿔치기 검사 <Icon name="arrow" size={16}/></button><button disabled={busy} onClick={() => void run(() => attack('old'))}>이전 VC로 새 요청 제출 <Icon name="arrow" size={16}/></button><button disabled={busy} onClick={() => void run(() => attack('replay'))}>완료한 승인 재사용 <Icon name="arrow" size={16}/></button></div>{tests && <div className="test-result" role="status">{tests}</div>}</details>}
          <p className="helper">테스트용 역할 전환입니다. 기관은 현재 같은 서버 프로세스에서 실행되며, 운영 환경의 서버·키 격리를 보장하지 않습니다. 실제 개인정보를 입력하지 마세요.</p><button className="text-button" onClick={() => { sessionStorage.removeItem('trust404.app.session'); location.href = '/app'; }}>새 데모 시작</button><details className="revocation-history"><summary>폐기 레지스트리 · 기록 보기</summary><p className="helper">{state.registry.label}</p>{role !== 'worker' ? <p className="helper">개별 폐기 기록은 근로자 화면에서 확인하세요.</p> : !state.revocations?.length ? <p className="helper">이 데모에서 폐기한 증명이 아직 없어요.</p> : state.revocations.map(r => <article key={r.index}><strong>{r.reason} · 기존 증명 폐기</strong><p>{new Date(r.call.at).toLocaleString('ko-KR')}</p><p>증명 식별자 <code>{r.index}</code></p><p>{state.registry.isStub ? '로컬 모의 처리 · 온체인 기록 없음' : '폐기 트랜잭션 성공 · ' + r.call.result}</p>{!state.registry.isStub && r.call.explorerUrl && <a href={r.call.explorerUrl} target="_blank" rel="noreferrer">익스플로러에서 폐기 트랜잭션 보기 ↗</a>}<button className="secondary" disabled={busy} onClick={() => void run(async () => { setRevocationChecks(prev => ({ ...prev, [r.index]: '조회 중…' })); try { const result = await api<{ revoked: boolean; checkedAt: number }>(`${base}/revocations/${r.index}`, session?.worker); setRevocationChecks(prev => ({ ...prev, [r.index]: (result.revoked ? '폐기됨' : '폐기되지 않음') + ' · ' + new Date(result.checkedAt).toLocaleTimeString('ko-KR') })); } catch (e) { setRevocationChecks(prev => ({ ...prev, [r.index]: '조회 실패 · 다시 시도해주세요.' })); throw e; } })}>{state.registry.isStub ? '현재 모의 상태 확인' : '현재 온체인 상태 확인'}</button>{revocationChecks[r.index] && <p role="status">{revocationChecks[r.index]}</p>}</article>)}<p className="helper">체인에는 증명 식별자와 폐기 기록만 남아요. 이름·주소 원문은 기록하지 않아요. 이 목록은 현재 데모 세션의 기록입니다.</p></details></>}
      </div><nav className="bottom-nav" aria-label="앱 메뉴">{(['home', 'identity', 'requests', 'settings'] as Tab[]).map(t => <button key={t} className={tab === t ? 'active' : ''} aria-current={tab === t ? 'page' : undefined} onClick={() => nav(t)}><Icon name={t}/><span>{({ home: '홈', identity: role === 'worker' ? '신원증명' : '사업장', requests: '요청함', settings: '더보기' })[t]}</span>{t === 'requests' && pending.length > 0 && <b>{pending.length}</b>}</button>)}</nav><div className="home-indicator"/></div><p className="device-caption">내 정보는 지갑에, 필요한 증명만 상대에게.</p></div>
  </div>;
}
