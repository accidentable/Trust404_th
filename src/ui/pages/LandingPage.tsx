/**
 * 랜딩 (/)
 *
 * 문제를 설명하지 않고 보여준다: 지금 실제로 오가는 대화 한 장.
 * 그다음 역할별 API 와 "사장님에게 남는 것"으로 해법을 잇고, [신분증 받기] 로 /merchant 에 들어간다.
 * 여섯 단계 인포그래픽은 README 에 있다.
 *
 * 톤: 흰 배경, 넓은 여백, 얇은 세로 가이드선, 대괄호 라벨, 큰 제목에 밑줄 한 구절, 채운 버튼 하나.
 */
import { MESSAGE_COUNT, MessageThread, useScrollReveal } from '../components/MessageThread';

/** 역할 카드 4장. 미리보기 줄은 그 API 응답의 핵심 3줄. 문구는 자리표시자. */
const ROLE_CARDS = [
  {
    id: 'issuer',
    step: '01',
    title: '주민센터 API',
    sub: '발급',
    color: 'var(--color-issuer)',
    lines: ['POST /api/issuer/issue', '→ 조각 4개 + 봉인 1개', '→ 평문 주민번호: 없음'],
  },
  {
    id: 'holder',
    step: '02',
    title: '알바생 지갑 API',
    sub: '보관 · 제시',
    color: 'var(--color-holder)',
    lines: ['GET  /api/holder/:id', 'POST /api/holder/:id/present', '→ 보여줌 2 · 잠김 1 · 안 보냄 2'],
  },
  {
    id: 'verifier',
    step: '03',
    title: '사장님 API',
    sub: '검증',
    color: 'var(--color-verifier)',
    lines: ['GET  /api/verifier/:session', '→ 검사 11개, 4줄 전부 ✓', '→ 봉인 열기: 실패'],
  },
  {
    id: 'tax',
    step: '04',
    title: '국세청 API',
    sub: '봉인 해제',
    color: 'var(--color-tax)',
    lines: ['POST /api/tax/unseal', '→ 010314-3******', '→ 지급명세서 작성'],
  },
];

const RECEIVED = ['성명', '만 18세 이상 · 예/아니오'];
const NOT_RECEIVED = ['주소', '사진', '발급일자', '주민등록번호 (봉인된 채 국세청으로)'];

export function LandingPage() {
  // 대화 섹션을 지나는 동안 메시지가 하나씩 드러난다. 올리면 역순으로 사라진다.
  const reveal = useScrollReveal(MESSAGE_COUNT);

  return (
    <div className="relative min-h-full">
      {/* 세로 가이드선: 레퍼런스의 편집 디자인 느낌. 콘텐츠 뒤에 깔린다. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 mx-auto hidden max-w-[1040px] md:block">
        <span className="absolute inset-y-0 left-1/3 w-px bg-line" />
        <span className="absolute inset-y-0 left-2/3 w-px bg-line" />
      </div>

      <div className="relative mx-auto max-w-[1040px] px-6 py-6">
        <nav className="flex items-center justify-between">
          <span className="mono text-[13px] tracking-wider">TRUST404</span>
          <div className="flex items-center gap-5">
            <a href="/wallet" className="text-[14px] text-ink-dim hover:text-ink">
              알바생 화면
            </a>
            <a href="/merchant" className="rounded-lg bg-ink px-4 py-2 text-[14px] font-medium text-white hover:opacity-85">
              신분증 받기
            </a>
          </div>
        </nav>

        {/* 히어로 */}
        <section className="pt-28 pb-24">
          <div className="mono text-[13px] text-verifier">[ 신분증 사본 없는 일당 지급 ]</div>
          <h1 className="mt-5 text-[44px] leading-[1.15] font-bold tracking-tight md:text-[56px]">
            주민등록증{' '}
            <span className="underline decoration-verifier decoration-[3px] underline-offset-[8px]">사본 없이</span>
            <br />
            알바비를 지급합니다
          </h1>
          <p className="mt-6 max-w-[560px] text-[16px] leading-relaxed text-ink-dim">
            세금 한 푼 걷지 않는 하루짜리 알바에도 주민등록증 사본이 카톡으로 오갑니다. 사장님은 그 번호를 국세청에
            넘겨야 할 뿐인데, 원본은 사장님 손에 남습니다. 사장님에게는 필요한 사실만, 주민등록번호는 봉인된 채 국세청으로.
          </p>
          <div className="mt-9 flex items-center gap-6">
            <a href="/merchant" className="rounded-lg bg-ink px-6 py-3 text-[15px] font-medium text-white hover:opacity-85">
              신분증 받기
            </a>
            <a href="#how" className="text-[14px] text-ink-dim underline underline-offset-4 hover:text-ink">
              어떻게 되나요 →
            </a>
          </div>
        </section>

        {/* 지금 벌어지는 일. 설명하지 않고 보여준다. 스크롤에 따라 대화가 하나씩 열린다. */}
        <section
          id="how"
          ref={reveal.ref}
          className="relative border-t border-line"
          style={{ height: `calc(100vh + ${MESSAGE_COUNT * 42}vh)` }}
        >
          <div className="sticky top-0 flex h-screen flex-col justify-center py-10">
            <div className="mono text-[13px] text-verifier">[ 지금 벌어지는 일 ]</div>
            <h2 className="mt-3 text-[26px] font-bold tracking-tight md:text-[28px]">
              이 대화를 없애는 것이 목표입니다
            </h2>

            <div className="mt-6 grid items-center gap-10 md:grid-cols-2">
              <MessageThread shown={reveal.shown} />

              {/* 대화를 다 읽은 뒤에 해설이 들어온다 */}
              <div
                className="hidden flex-col gap-4 transition-all duration-500 md:flex"
                style={{
                  opacity: reveal.done ? 1 : 0,
                  transform: reveal.done ? 'none' : 'translateY(12px)',
                }}
                aria-hidden={!reveal.done}
              >
                <p className="text-[16px] leading-relaxed">
                  사장님이 나쁜 사람이라서가 아닙니다. 지급명세서를 내려면 주민등록번호가 필요하고,
                  받는 방법이 이것뿐이라 이렇게 합니다.
                </p>
                <div className="rounded-xl border border-line bg-panel px-5 py-4">
                  <div className="text-[13px] font-semibold text-verifier">사진 한 장에 들어 있는 것</div>
                  <ul className="mt-2 space-y-1 text-[15px]">
                    <li>주민등록번호 13자리</li>
                    <li>주소</li>
                    <li>얼굴 사진</li>
                    <li>발급일자</li>
                  </ul>
                  <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">
                    이 중 사장님에게 필요한 건 하나도 없습니다. 주민등록번호조차 국세청에 넘기기 위한
                    것이고, 사장님이 볼 이유는 없습니다.
                  </p>
                </div>
                <p className="text-[15px] leading-relaxed text-ink-dim">
                  그런데도 원본은 사장님 카톡방에, 컴퓨터에, 메일함에 남습니다.
                  <b className="text-ink"> 유출되면 그때 문제가 됩니다.</b>
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* 좁은 화면에서는 해설을 대화 아래에 따로 둔다 */}
        <section className="border-t border-line py-14 md:hidden">
          <p className="text-[16px] leading-relaxed">
            사장님이 나쁜 사람이라서가 아닙니다. 지급명세서를 내려면 주민등록번호가 필요하고,
            받는 방법이 이것뿐이라 이렇게 합니다.
          </p>
          <div className="mt-5 rounded-xl border border-line bg-panel px-5 py-4">
            <div className="text-[13px] font-semibold text-verifier">사진 한 장에 들어 있는 것</div>
            <ul className="mt-2 space-y-1 text-[15px]">
              <li>주민등록번호 13자리</li>
              <li>주소</li>
              <li>얼굴 사진</li>
              <li>발급일자</li>
            </ul>
            <p className="mt-3 text-[13px] leading-relaxed text-ink-dim">
              이 중 사장님에게 필요한 건 하나도 없습니다.
            </p>
          </div>
        </section>

        {/* 역할 카드 4장. 누르면 그 역할의 페이지(/issuer /holder /verifier /tax)로 간다. 문구는 자리표시자. */}
        <section className="border-t border-line py-20">
          <div className="mono text-[13px] text-verifier">[ 역할별 API ]</div>
          <h2 className="mt-4 text-[28px] font-bold tracking-tight">네 역할, 네 개의 API</h2>
          <p className="mt-2 text-[14px] text-ink-dim">카드를 누르면 그 역할의 API 를 직접 실행해 볼 수 있습니다.</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 md:grid-cols-4">
            {ROLE_CARDS.map((card) => (
              <a
                key={card.id}
                href={`/${card.id}`}
                className="group flex flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition hover:border-line-strong hover:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.15)]"
              >
                <div className="px-5 pt-5 pb-4">
                  <div className="text-[19px] font-bold tracking-tight">{card.title}</div>
                  <div className="mt-3 flex items-center gap-2.5">
                    <span
                      className="mono flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                      style={{ background: card.color }}
                    >
                      {card.step}
                    </span>
                    <span className="text-[14px] text-ink-dim">{card.sub}</span>
                  </div>
                </div>
                <div className="mt-auto bg-bg px-4 pt-4">
                  <div className="rounded-t-lg border border-b-0 border-line bg-panel px-3 pt-3 pb-4">
                    {card.lines.map((line) => (
                      <div key={line} className="mono truncate text-[11px] leading-[1.9] text-ink-dim">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>

        {/* 받는 것 / 받지 않는 것 */}
        <section className="border-t border-line py-20">
          <div className="mono text-[13px] text-verifier">[ 사장님 화면에 남는 것 ]</div>
          <div className="mt-8 grid gap-8 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-panel px-6 py-5">
              <div className="text-[13px] font-semibold text-holder">받는 것</div>
              <ul className="mt-3 space-y-2">
                {RECEIVED.map((item) => (
                  <li key={item} className="flex gap-2.5 text-[16px]">
                    <span className="text-holder">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-line bg-panel px-6 py-5">
              <div className="text-[13px] font-semibold text-ink-faint">받지 않는 것</div>
              <ul className="mt-3 space-y-2">
                {NOT_RECEIVED.map((item) => (
                  <li key={item} className="flex gap-2.5 text-[16px] text-ink-dim">
                    <span className="text-ink-faint">✗</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-8 max-w-[560px] text-[14px] leading-relaxed text-ink-dim">
            "안 보내기"와 "잠가서 보내기"는 다릅니다. 주소는 조각을 보내지 않아 존재조차 모르고, 주민등록번호는 잠가서
            보내 갖고는 있지만 열 수 없습니다. 여는 열쇠는 국세청에만 있습니다.
          </p>
        </section>

        {/* 마무리 */}
        <section className="border-t border-line py-20">
          <h2 className="text-[28px] font-bold tracking-tight">지금 받아 보세요</h2>
          <p className="mt-3 text-[15px] text-ink-dim">
            사장님 화면에서 필요한 정보를 고르고 QR 을 띄우면 됩니다. 알바생은 폰으로 찍기만 하면 됩니다.
          </p>
          <div className="mt-8 flex items-center gap-6">
            <a href="/merchant" className="rounded-lg bg-ink px-6 py-3 text-[15px] font-medium text-white hover:opacity-85">
              신분증 받기
            </a>
            <a href="/wallet" className="text-[14px] text-ink-dim underline underline-offset-4 hover:text-ink">
              알바생 화면 보기 →
            </a>
          </div>
        </section>

        <footer className="border-t border-line py-8 text-[12px] text-ink-faint">
          선택적 공개는 EU 표준(EUDI · SD-JWT)의 기본 기능이고 이 프로젝트의 발명이 아닙니다. 우리가 채운 칸은 국세청만
          열 수 있는 봉인 필드 하나입니다. 실제 동작에는 홈택스가 이 포맷을 수용해야 하며, 여기 국세청은 목업입니다.
        </footer>
      </div>
    </div>
  );
}
