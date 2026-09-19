import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 문제를 설명하지 않고 보여준다.
 * 지금 실제로 오가는 대화를 iMessage 형태로 재현한 목업.
 *
 * 스크롤에 따라 메시지가 하나씩 나타나고, 올리면 역순으로 사라진다.
 * 대화를 읽는 속도가 스크롤 속도가 되도록 한 것이다.
 */
const BUBBLE_GRAY = '#e9e9eb';
const BUBBLE_BLUE = '#0a84ff';

type Message =
  | { kind: 'received' | 'sent'; body: ReactNode }
  | { kind: 'image' }
  | { kind: 'thought'; body: ReactNode };

const MESSAGES: Message[] = [
  { kind: 'received', body: '태호야, 이번 달 급여 들어갈 건데' },
  {
    kind: 'received',
    body: (
      <>
        계좌랑 <b className="font-semibold">신분증 사본</b> 좀 보내줘
      </>
    ),
  },
  { kind: 'sent', body: '네 알겠습니다' },
  { kind: 'image' },
  {
    kind: 'thought',
    body: (
      <>
        도용당하면 어떡하지…
        <br />
        근데 안 보내면 월급을 못 받으니까
      </>
    ),
  },
];

/** 마지막 메시지가 이 진행도에서 다 드러난다. 나머지 구간은 읽을 여유. */
const REVEAL_UNTIL = 0.8;

export function useScrollReveal(total: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setShown(total);
      setDone(true);
      return;
    }

    let frame = 0;
    const update = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      // 컨테이너가 화면을 지나가는 동안의 진행도 0→1
      const scrollable = el.offsetHeight - window.innerHeight;
      if (scrollable <= 0) {
        setShown(total);
        setDone(true);
        return;
      }
      const progress = Math.min(1, Math.max(0, -el.getBoundingClientRect().top / scrollable));
      setShown(Math.min(total, Math.floor((progress / REVEAL_UNTIL) * total)));
      setDone(progress >= REVEAL_UNTIL);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [total]);

  return { ref, shown, done };
}

export const MESSAGE_COUNT = MESSAGES.length;

export function MessageThread({ shown }: { shown: number }) {
  return (
    <div className="mx-auto w-full max-w-[380px] overflow-hidden rounded-[28px] border border-line bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(0,0,0,0.18)]">
      <div className="flex flex-col items-center gap-1 border-b border-line bg-[#f6f6f6] px-4 pt-3 pb-2.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[#c7c7cc] text-[17px] text-white">
          사
        </div>
        <div className="text-[13px] font-medium text-ink">사장님</div>
      </div>

      {/* 메시지가 늘어도 높이가 튀지 않도록 아래를 비워 둔다 */}
      <div className="flex min-h-[420px] flex-col justify-end gap-1.5 px-3.5 pt-4 pb-5">
        <div className="mb-1 text-center text-[11px] text-ink-faint">오후 6:24</div>
        {MESSAGES.map((message, index) => (
          <Reveal key={index} visible={index < shown}>
            <MessageRow message={message} />
          </Reveal>
        ))}
      </div>
    </div>
  );
}

/** 나타날 때와 사라질 때 모두 같은 전환을 쓴다. */
function Reveal({ visible, children }: { visible: boolean; children: ReactNode }) {
  return (
    <div
      className="transition-all duration-300 ease-out"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'none' : 'translateY(8px) scale(0.97)',
        maxHeight: visible ? '260px' : '0px',
        marginBottom: visible ? undefined : '-6px',
        pointerEvents: visible ? undefined : 'none',
      }}
      aria-hidden={!visible}
    >
      {children}
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  if (message.kind === 'received') {
    return (
      <div className="flex justify-start pt-1.5">
        <div
          className="max-w-[78%] rounded-[18px] rounded-bl-[5px] px-3.5 py-2 text-[15px] leading-snug text-ink"
          style={{ background: BUBBLE_GRAY }}
        >
          {message.body}
        </div>
      </div>
    );
  }
  if (message.kind === 'sent') {
    return (
      <div className="flex justify-end pt-1.5">
        <div
          className="max-w-[78%] rounded-[18px] rounded-br-[5px] px-3.5 py-2 text-[15px] leading-snug text-white"
          style={{ background: BUBBLE_BLUE }}
        >
          {message.body}
        </div>
      </div>
    );
  }
  if (message.kind === 'image') {
    return (
      <div className="flex justify-end pt-1.5">
        <div className="w-[170px] overflow-hidden rounded-[18px] rounded-br-[5px] border border-line">
          <IdCardImage />
        </div>
      </div>
    );
  }
  return (
    <div className="pt-3">
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[16px] border border-dashed border-line-strong px-3 py-2 text-[13px] leading-relaxed text-ink-dim">
          {message.body}
        </div>
      </div>
      <div className="mt-1 text-right text-[11px] text-ink-faint">속마음</div>
    </div>
  );
}

/** 주민등록증 사진 자리. 실물을 그리지 않고, 무엇이 통째로 넘어가는지만 드러낸다. */
function IdCardImage() {
  return (
    <div className="bg-[#eceff3] px-3 py-3">
      <div className="rounded-lg bg-white px-3 py-2.5 shadow-sm">
        <div className="text-[9px] tracking-wide text-ink-faint">주민등록증</div>
        <div className="mt-1.5 flex items-start gap-2.5">
          <div className="h-[34px] w-[26px] shrink-0 rounded-sm bg-[#d8dce2]" />
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-semibold text-ink">윤O호</div>
            <div className="mono mt-0.5 text-[10px] text-ink">
              010314-<span className="rounded-sm bg-[#ffd9d9] px-0.5 text-[#c92a2a]">3●●●●●●</span>
            </div>
            <div className="mt-0.5 truncate text-[9px] text-ink-dim">서울특별시 성북구 …</div>
          </div>
        </div>
        <div className="mt-1.5 text-right text-[8px] text-ink-faint">2019. 03. 21. 발급</div>
      </div>
    </div>
  );
}
