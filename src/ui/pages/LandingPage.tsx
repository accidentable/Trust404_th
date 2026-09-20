import { MESSAGE_COUNT, MessageThread, useScrollReveal } from '../components/MessageThread';
import { PayApp } from './PayApp';
import './landing.css';

export function LandingPage() {
  const reveal = useScrollReveal(MESSAGE_COUNT);
  return <main className="demo-landing">
    <PayApp landing />
    <section id="why" ref={reveal.ref} className="landing-conversation" style={{ height: `calc(100vh + ${MESSAGE_COUNT * 42}vh)` }}>
      <div className="conversation-sticky">
        <div className="conversation-copy">
          <span className="conversation-label">WHY SabonX</span>
          <h2>월급을 받으려고,<br/>내 전부를 보내야 할까?</h2>
          <p>익숙한 부탁 한마디.<br/>이름과 함께 주소, 사진, 주민등록번호까지<br/>대화방에 남습니다.</p>
          <div className="conversation-resolution" style={{ opacity: reveal.done ? 1 : 0 }} aria-hidden={!reveal.done}>
            <strong>신분증 사본 대신, 필요한 증명만.</strong>
            <p>근로자는 지급 내역을 확인하고 서명합니다.<br/>사업주는 신분증 원본 대신 접수 결과를 받습니다.</p>
            <a href="/app">앱에서 직접 해보기 <span aria-hidden>↗</span></a>
          </div>
        </div>
        <MessageThread shown={reveal.shown}/>
      </div>
    </section>
    <footer className="landing-footer"><a href="/">SabonX</a><p>실제 암호 검증 · 가상 신원정보<br/>정부 기관과 연동되지 않은 해커톤 데모</p><a href="/app">앱 열기 ↗</a></footer>
  </main>;
}
