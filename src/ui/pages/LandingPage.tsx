/**
 * 랜딩 (/)
 *
 * 프로세스를 단계별로 설명하고, 사장님이 누르는 [신분증 받기] 로 /merchant 에 들어간다.
 * 톤: 흰 배경, 넓은 여백, 얇은 세로 가이드선, 대괄호 라벨, 큰 제목에 밑줄 한 구절, 채운 버튼 하나.
 */
/** 주민센터에서 국세청까지, 한 번의 지급이 지나가는 여섯 단계. */
const STEPS = [
  {
    n: '01',
    who: '주민센터',
    title: '신분 자격증명을 발급합니다',
    body: '이미 갖고 있는 정보로 서명해 알바생 지갑에 넣습니다. 주민등록번호는 이때 국세청 공개키로 봉인됩니다. 신분증 사진을 올리는 단계는 없습니다.',
  },
  {
    n: '02',
    who: '알바생',
    title: '지갑에 보관합니다',
    body: '자격증명과 개인키는 알바생의 폰에만 있습니다. 서버에도, 사장님에게도 올라가지 않습니다.',
  },
  {
    n: '03',
    who: '사장님',
    title: '필요한 정보만 요청합니다',
    body: '일당 지급이면 성명과 만 18세 여부. 주소, 사진, 발급일자는 애초에 요청하지 않고 QR 을 띄웁니다.',
  },
  {
    n: '04',
    who: '알바생',
    title: '줄 것만 골라 제시합니다',
    body: '보여줄 정보, 잠긴 채 전달, 보내지 않음. 세 칸이 화면에 그대로 보이고, 과한 요청이면 경고가 뜹니다.',
  },
  {
    n: '05',
    who: '사장님',
    title: '검증합니다',
    body: '서명, 유효기간, 본인 제시, 폐기 여부. 발급기관에 묻지 않으니 어디서 썼는지 새지 않습니다. 봉인은 열리지 않은 채 남습니다.',
  },
  {
    n: '06',
    who: '국세청',
    title: '봉인을 열어 신고를 받습니다',
    body: '사장님이 신고서에 그대로 첨부한 봉인을 국세청만 열어 지급명세서를 씁니다. 사장님 손에 번호는 남지 않습니다.',
  },
];

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

        {/* 단계 */}
        <section id="how" className="border-t border-line py-20">
          <div className="mono text-[13px] text-verifier">[ 여섯 단계 ]</div>
          <h2 className="mt-4 text-[28px] font-bold tracking-tight">주민센터에서 국세청까지</h2>
          <p className="mt-2 text-[14px] text-ink-dim">사진 한 장 대신, 사실 두 개가 지나갑니다.</p>

          {/* 인포그래픽. 원본 조각은 assets/infographic-panels.fragment.svg, 완성본은 public/process.svg */}
          <div className="mt-8 -mx-6 overflow-x-auto px-6 md:mx-0 md:px-0">
            <img
              src="/process.svg"
              alt="주민센터에서 국세청까지 여섯 단계. 성명과 만 18세 여부는 사장님까지, 주민등록번호는 잠긴 채 국세청까지, 주소와 사진은 알바생 지갑에서 멈춘다."
              className="h-auto w-full min-w-[880px] md:min-w-0"
            />
          </div>

          <ol className="mt-10 grid gap-x-10 gap-y-10 md:grid-cols-2">
            {STEPS.map((step) => (
              <li key={step.n} className="flex gap-5">
                <span className="mono mt-1 text-[13px] text-ink-faint">{step.n}</span>
                <div>
                  <div className="mono text-[12px] text-verifier">{step.who}</div>
                  <div className="mt-0.5 text-[17px] font-semibold">{step.title}</div>
                  <p className="mt-1.5 text-[14px] leading-relaxed text-ink-dim">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
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
