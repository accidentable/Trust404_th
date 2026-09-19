import type { ReactNode } from 'react';
import type { CredentialView } from '../../shared/api';
import { describeClaim } from '../../shared/schema';
import { shortenDid } from '../../shared/did';
import { Row } from './primitives';

/**
 * 역할 페이지 공통 조각. 네 페이지(/issuer /holder /verifier /tax)가 같은 뼈대와 요약 부품을 쓴다.
 * 페이지는 서로 다른 주체이므로 각자 열리고, 단계 간 전달은 URL(h=holderId, s=sessionId)로만 한다.
 */
export const ROLE_COLOR = {
  issuer: 'var(--color-issuer)',
  holder: 'var(--color-holder)',
  verifier: 'var(--color-verifier)',
  tax: 'var(--color-tax)',
} as const;

export interface NavLink {
  label: string;
  /** 아직 넘어갈 수 없으면(앞 단계 결과가 없으면) 비워 둔다. 버튼은 흐리게 보인다. */
  href?: string;
}

export function RoleShell({
  step,
  role,
  color,
  endpoint,
  prev,
  next,
  children,
}: {
  step: string;
  role: string;
  color: string;
  endpoint: string;
  prev?: NavLink;
  next?: NavLink;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-[880px] flex-col px-8 py-6">
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <a href="/" className="mono text-[13px] tracking-wider text-ink-dim hover:text-ink">
            TRUST404
          </a>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="mono text-[12px] text-ink-faint">{step}</span>
            <span className="text-[18px] font-semibold" style={{ color }}>
              {role}
            </span>
          </div>
          <div className="mono truncate text-[12px] text-ink-dim">{endpoint}</div>
        </div>
        <nav className="flex shrink-0 items-center gap-4 text-[13px]">
          {prev ? (
            <a href={prev.href} className="text-ink-dim hover:text-ink">
              ← {prev.label}
            </a>
          ) : null}
          {next ? (
            next.href ? (
              <a href={next.href} className="rounded-lg bg-ink px-4 py-2 font-medium text-white hover:opacity-85">
                {next.label} →
              </a>
            ) : (
              <span className="rounded-lg bg-ink px-4 py-2 font-medium text-white opacity-30">{next.label} →</span>
            )
          ) : null}
        </nav>
      </header>
      <div className="mt-6">{children}</div>
    </div>
  );
}

export function ErrorBar({ message }: { message: string }) {
  if (!message) return null;
  return <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-bad">{message}</div>;
}

/** 앞 단계 결과가 없을 때. */
export function NeedPrevious({ what, href, label }: { what: string; href: string; label: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-6 py-5 text-[14px]">
      <div className="text-ink-dim">{what}</div>
      <a href={href} className="mt-3 inline-block rounded-lg bg-ink px-4 py-2 text-[13px] font-medium text-white hover:opacity-85">
        {label} →
      </a>
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-xl border border-line bg-panel px-6 py-5">{children}</section>;
}

export function Result({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-lg border border-line bg-bg px-4 py-3">
      {title ? <div className="mb-2 text-[12px] font-semibold text-ink-dim">{title}</div> : null}
      {children}
    </div>
  );
}

export function Bucket({ color, title, children }: { color: string; title: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline gap-4 py-1.5 text-[14px]">
      <span className="w-[112px] shrink-0 font-semibold" style={{ color }}>
        {title}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span
      className="inline-block rounded-md px-2 py-0.5 text-[13px] font-semibold"
      style={{
        color: ok ? 'var(--color-ok)' : 'var(--color-bad)',
        background: ok ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)',
      }}
    >
      {ok ? '✓ ' : '✕ '}
      {children}
    </span>
  );
}

export function Field({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-ink-dim">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line-strong bg-panel px-3 py-2 text-[14px] outline-none placeholder:text-ink-faint focus:border-ink"
      />
    </label>
  );
}

/** 원본 응답은 접어 둔다. 긴 토큰은 앞부분만. */
export function JsonDetails({ value }: { value: unknown }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer select-none text-[12px] text-ink-dim hover:text-ink">JSON 보기</summary>
      <pre className="mono mt-2 max-h-[440px] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-panel px-4 py-3 text-[12px] leading-relaxed text-ink">
        {JSON.stringify(
          value,
          (_key, v: unknown) => (typeof v === 'string' && v.length > 96 ? `${v.slice(0, 64)}… (${v.length}자)` : v),
          2,
        )}
      </pre>
    </details>
  );
}

/** 자격증명 한 장의 요약: 선택 공개 조각 · 봉인 · 평문. 주민센터와 지갑 페이지가 같이 쓴다. */
export function CredentialSummary({ credential }: { credential: CredentialView }) {
  const selective = Object.entries(credential.selective);
  const sealed = Object.entries(credential.sealed);
  const plaintext = Object.entries(credential.plaintext);
  return (
    <div className="mt-2 border-t border-line pt-2">
      {credential.issuerDid ? (
        <Row label="발급기관" value={<span className="mono">{shortenDid(credential.issuerDid, 22, 8)}</span>} />
      ) : null}
      {credential.expiresAt ? <Row label="만료" value={new Date(credential.expiresAt * 1000).toLocaleString('ko-KR')} /> : null}
      <div className="mt-2 mb-1 text-[12px] font-semibold" style={{ color: ROLE_COLOR.holder }}>
        선택 공개 조각 {selective.length}개
      </div>
      {selective.map(([key, item]) => (
        <Row key={key} label={describeClaim(key).label} value={fmt(item.value)} />
      ))}
      <div className="mt-2 mb-1 text-[12px] font-semibold text-sealed">잠긴 채 담김 {sealed.length}개</div>
      {sealed.map(([key, seal]) => (
        <Row
          key={key}
          label={describeClaim(key).label}
          value={
            <span>
              🔒{' '}
              <span className="mono text-[12px] text-ink-dim">
                {seal.algorithm} · {seal.encryption}
              </span>
              {seal.audience ? <span className="ml-2 text-[12px] text-sealed">{seal.audience}만 열 수 있음</span> : null}
            </span>
          }
        />
      ))}
      {plaintext.map(([key, value]) => (
        <Row key={key} label={describeClaim(key).label} value={<span className="mono">{String(value)}</span>} />
      ))}
    </div>
  );
}

export function fmt(value: unknown): string {
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return String(value ?? '');
}

/** URL 의 단계 전달 값. */
export function queryParam(name: string): string | undefined {
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

/** 새로고침해도 이어지도록 URL 을 갱신한다. 페이지는 바뀌지 않는다. */
export function setQuery(params: Record<string, string | undefined>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  window.history.replaceState(null, '', url.toString());
}
