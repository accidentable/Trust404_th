import { useState, useEffect, useRef, type FormEvent } from 'react';
import type { PayRequest } from '../../shared/payroll';
import './pay-review.css';

type Props = { item: PayRequest; name: string; busy: boolean; valid: boolean; onSubmit: () => void; onCorrection: (message: string) => Promise<void>; onIdentity: () => void; onClose: () => void };
export function PayReview({ item, name, busy, valid, onSubmit, onCorrection, onIdentity, onClose }: Props) {
  const panel = useRef<HTMLElement>(null);
  const [step, setStep] = useState(0);
  const [correction, setCorrection] = useState(false);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => { panel.current?.closest('.phone-scroll')?.scrollTo({ top: 0 }); }, [step, correction]);
  async function correct(e: FormEvent) {
    e.preventDefault(); if (sending || busy) return;
    setSending(true); setFailure('');
    try { await onCorrection(message.trim()); } catch (e) { setFailure((e as Error).message); } finally { setSending(false); }
  }
  const amount = new Intl.NumberFormat('ko-KR').format(item.amount);
  return <section ref={panel} className="pay-review" aria-label="급여 확인 단계">
    <button className="back-link" disabled={busy || sending} onClick={() => correction ? setCorrection(false) : step ? setStep(step - 1) : onClose()}>‹ {correction || step ? '이전' : '요청 목록'}</button>
    {!correction && <div className="review-progress" aria-label={`${step + 1}/3 단계`}>{[0,1,2].map(n => <span key={n} className={n <= step ? 'filled' : ''}/>)}</div>}
    {correction ? <form onSubmit={e => void correct(e)} className="review-slide">
      <header className="page-heading"><p>{item.business} · {item.month}</p><h1>어떤 내용을<br/>바꿔야 하나요?</h1></header>
      <p className="review-description">사장님이 확인할 수 있도록 수정이 필요한 내용을 알려주세요.</p>
      <label className="correction-label" htmlFor="correction-message">정정 요청 메시지 <span>선택</span></label>
      <textarea id="correction-message" className="correction-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={500} placeholder="예: 이번 달 추가 근무 3시간이 빠진 것 같아요. 확인 부탁드려요." disabled={sending}/>
      <div className="message-count">{message.length}/500</div>
      <p className="helper">이 메시지는 사업주에게 전달돼요. 주민등록번호 등 민감한 정보는 적지 마세요.</p>
      {failure && <div className="app-alert error" role="alert">{failure}</div>}
      <button className="primary" disabled={busy || sending}>{sending ? '보내는 중…' : '정정 요청 보내기'}</button>
    </form> : <div className="review-slide" key={step}>
      <header className="page-heading"><p>0{step + 1} · {['급여 확인', '전송 정보', '최종 확인'][step]}</p><h1>{step === 0 ? <>이번 달 급여를<br/>확인해주세요</> : step === 1 ? <>어떤 정보를<br/>보내나요?</> : <>확인한 내용으로<br/>서명할까요?</>}</h1></header>
      {step === 0 && <><div className="review-salary"><span>{item.business}</span><p>{item.month.replace('-', '년 ')}월 급여</p><strong>{amount}<small>원</small></strong></div><p className="review-description">사업장과 지급 금액이 맞는지 확인해주세요.<br/>아직 서명하거나 전송하지 않아요.</p><button className="primary" onClick={() => setStep(1)}>다음</button><button className="text-button" onClick={() => setCorrection(true)}>금액이 달라요 · 정정 요청</button></>}
      {step === 1 && <><div className="review-disclosures">
        <div className="reveal-info name-info"><span className="review-symbol check-symbol" aria-hidden="true">✓</span><div><h2>이름은 공개해요</h2><p>{name}</p></div></div>
        <div className="reveal-info sealed-info"><span className="review-symbol lock-symbol" aria-hidden="true"><svg width="25" height="29" viewBox="0 0 25 29" fill="none" stroke="currentColor" strokeWidth="2"><path className="lock-shackle" d="M6 13V8a6.5 6.5 0 0 1 13 0v5"/><rect x="3" y="12" width="19" height="14" rx="4"/><path d="M12.5 17v4"/></svg></span><div><h2>주민번호는 봉인해서</h2><p>모의 국세청만 열 수 있어요.</p></div></div>
        <div className="reveal-info omitted-info"><div><h2>나머지 정보는 보내지 않아요</h2><p>주소 · 사진 · 생년월일 · 발급정보</p></div></div>
      </div><p className="review-unsent">마지막 서명 후 전송돼요.</p><button className="primary" onClick={() => setStep(2)}>확인했어요</button></>}
      {step === 2 && <><div className="review-summary"><strong>{item.business}</strong><span>{item.month} 급여</span><b>{amount}원</b><hr/><p>이름 · 봉인된 주민등록번호</p><small>받는 곳: 모의 국세청</small></div><p className="review-description">이 지급 내역을 확인하고, 표시된 정보를 모의 세무기관에 제출합니다.</p>{!valid && <div className="app-alert error">유효한 신원증명이 필요해요. 발급 또는 업데이트 후 다시 확인해주세요.</div>}{!valid && <button className="text-button demo-submit" disabled={busy} onClick={onSubmit}>무시하고 제출하기</button>}<button className="primary" disabled={busy || !valid} onClick={onSubmit}>{busy ? '서명하고 검증하는 중…' : '서명하고 제출하기'}</button>{!valid && <button className="secondary" onClick={onIdentity}>신원증명 확인하기</button>}<button className="text-button" disabled={busy} onClick={() => setCorrection(true)}>내역이 달라요 · 정정 요청</button></>}
    </div>}
  </section>;
}
