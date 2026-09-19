import type { ReactNode } from 'react';

/** 주 액션 버튼. 화면에 하나만 둔다. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="rounded-lg bg-ink px-5 py-2.5 text-[14px] font-medium text-white transition hover:opacity-85 disabled:opacity-30"
    >
      {busy ? '처리 중…' : children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-lg border border-line-strong px-4 py-2 text-[13px] text-ink-dim transition hover:bg-bg disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** 라벨 · 값 한 줄 */
export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 py-1.5 text-[14px]">
      <span className="w-[112px] shrink-0 text-ink-dim">{label}</span>
      <span className="min-w-0 flex-1 break-all">{value}</span>
    </div>
  );
}

/** ✓ / ✕ 한 줄 */
export function CheckLine({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <span
        className="mt-[2px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
        style={{ background: ok ? 'var(--color-ok)' : 'var(--color-bad)' }}
      >
        {ok ? '✓' : '✕'}
      </span>
      <div className="min-w-0">
        <div className="text-[14px]">{label}</div>
        {detail ? <div className="mt-0.5 text-[12px] text-ink-dim">{detail}</div> : null}
      </div>
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="text-[13px] leading-relaxed text-ink-dim">{children}</p>;
}
