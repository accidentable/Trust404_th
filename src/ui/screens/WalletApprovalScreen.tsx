import type { ReactNode } from 'react';
import type { ApprovalPlan } from '../../shared/types';
import { PrimaryButton, SecondaryButton } from '../components/primitives';
import { requiredClaimsFor } from '../../shared/schema';

/**
 * 지갑 승인 화면: 3칸(보여줌 / 잠김 / 안 보냄)이 이 프로젝트의 얼굴이다.
 * 항목은 요청의 `requested` 에서 나온다. 사장님이 체크를 바꾸면 여기가 바뀐다.
 */
export function WalletApprovalScreen({
  plan,
  onToggleDeny,
  onPresent,
  onReject,
  presented,
  busy,
}: {
  plan: ApprovalPlan;
  onToggleDeny: (key: string) => void;
  onPresent: () => void;
  onReject: () => void;
  presented: boolean;
  busy: boolean;
}) {
  const required = requiredClaimsFor(plan.purpose);
  const excessive = plan.shown.filter((item) => required.length > 0 && !required.includes(item.key));

  return (
    <div className="flex h-full flex-col">
      <div className="mb-5">
        <div className="text-[18px] font-semibold">{plan.verifier}</div>
        <div className="text-[14px] text-ink-dim">{plan.purpose}</div>
      </div>

      {excessive.length > 0 ? (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-bad">
          ⚠ 이 용도에는 {excessive.map((item) => item.label).join(', ')}가 필요하지 않습니다
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <Box title="보여줄 정보" color="var(--color-holder)">
          {plan.shown.length === 0 ? <Empty /> : null}
          {plan.shown.map((item) => (
            <Line key={item.key} mark="✓" color="var(--color-holder)">
              {item.label} · {formatValue(item.value)}
              {!presented ? (
                <button
                  type="button"
                  onClick={() => onToggleDeny(item.key)}
                  className="ml-auto text-[12px] text-ink-faint hover:text-ink"
                >
                  빼기
                </button>
              ) : null}
            </Line>
          ))}
        </Box>

        <Box title="잠긴 채 전달 (상대는 열 수 없음)" color="var(--color-sealed)">
          {plan.sealed.length === 0 ? <Empty /> : null}
          {plan.sealed.map((item) => (
            <Line key={item.key} mark="🔒" color="var(--color-sealed)">
              {item.label}
              <span className="ml-2 text-[12px] text-ink-dim">국세청만 열 수 있음</span>
            </Line>
          ))}
        </Box>

        <Box title="보내지 않음" color="var(--color-ink-faint)">
          {plan.withheld.length === 0 ? <Empty /> : null}
          {plan.withheld.map((item) => (
            <Line key={item.key} mark="✗" color="var(--color-ink-faint)" dim>
              {item.label}
              {!presented && item.note?.includes('거부') ? (
                <button
                  type="button"
                  onClick={() => onToggleDeny(item.key)}
                  className="ml-auto text-[12px] text-ink-faint hover:text-ink"
                >
                  되돌리기
                </button>
              ) : null}
            </Line>
          ))}
        </Box>
      </div>

      <div className="flex-1" />

      <div className="flex items-center justify-between border-t border-line pt-4">
        {presented ? (
          <span className="text-[14px] text-holder">제시 완료</span>
        ) : (
          <>
            <SecondaryButton onClick={onReject} disabled={busy}>
              거부
            </SecondaryButton>
            <PrimaryButton onClick={onPresent} busy={busy}>
              제시하기
            </PrimaryButton>
          </>
        )}
      </div>
    </div>
  );
}

function Box({ title, color, children }: { title: string; color: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <div className="mb-1 text-[12px] font-semibold" style={{ color }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Line({
  mark,
  color,
  dim,
  children,
}: {
  mark: string;
  color: string;
  dim?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5 py-1 text-[15px]" style={{ color: dim ? 'var(--color-ink-dim)' : undefined }}>
      <span className="w-4 text-center" style={{ color }}>
        {mark}
      </span>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="py-1 text-[14px] text-ink-faint">없음</div>;
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return String(value ?? '');
}
