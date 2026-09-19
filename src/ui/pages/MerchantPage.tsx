import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { EmployerVerifier } from '../../verifier/employer';
import { RemoteRevocationRegistry, type RevocationRegistry } from '../../shared/revocation';
import { loadVerifierRegistry, type ChainInfo } from '../chain';
import {
  DEFAULT_CASE,
  PURPOSE_CASES,
  REQUESTABLE_CLAIMS,
  VCT_RESIDENT_ID,
  describeClaim,
  type PurposeCase,
} from '../../shared/schema';
import {
  api,
  type IssuerInfo,
  type MerchantRegistered,
  type MerchantSessions,
  type SessionRecord,
} from '../../shared/api';
import type { VerificationReport } from '../../shared/types';
import { groupChecks } from '../verification';
import { Note, PrimaryButton, SecondaryButton } from '../components/primitives';

/**
 * 사장님 화면 (/merchant)
 *
 *   1. 사례를 고른다 (누가 · 무슨 용도) → 그 용도에 필요한 항목이 기본 체크된다
 *   2. 항목을 조정한다 → 서버에 템플릿 등록 (바꿀 때마다 재등록, QR 은 그대로)
 *   3. [QR 띄우기] → 알바생이 폰으로 찍으면 /wallet?m=<id> 가 열린다
 *   4. 들어오는 제시가 아래에 누적된다. 검증은 이 브라우저에서 한다: 서버는 중계만.
 */
export const MERCHANT_ID_KEY = 'trust404.merchant.id';
const POLL_MS = 2000;

interface Row {
  session: SessionRecord;
  report?: VerificationReport;
}

export function MerchantPage() {
  const [merchantId, setMerchantId] = useState<string>();
  const [issuerDid, setIssuerDid] = useState<string>();
  const [useCase, setUseCase] = useState<PurposeCase>(DEFAULT_CASE);
  const [requested, setRequested] = useState<string[]>([...DEFAULT_CASE.required]);
  const [rows, setRows] = useState<Row[]>([]);
  const [showQr, setShowQr] = useState(false);
  const [qrSrc, setQrSrc] = useState('');
  const [error, setError] = useState('');
  /** 행별 [열어 보기] 결과: 항상 실패다. 그걸 보여주는 게 목적이다. */
  const [openResults, setOpenResults] = useState<Record<string, string>>({});

  const verifier = useRef(new EmployerVerifier());
  // 폐기 조회 레지스트리. 체인이 설정돼 있으면 이 브라우저가 RPC 를 직접 읽는다 (서버=발급기관을 거치지 않는다).
  const [registry, setRegistry] = useState<RevocationRegistry>(() => new RemoteRevocationRegistry());
  const [chainInfo, setChainInfo] = useState<ChainInfo>();
  const reports = useRef(new Map<string, VerificationReport>());
  const verifying = useRef(new Set<string>());

  // 요청 템플릿 등록. 사례나 체크박스가 바뀔 때마다 같은 id 로 재등록한다: QR 은 그대로다.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        let saved: string | undefined;
        try {
          saved = localStorage.getItem(MERCHANT_ID_KEY) ?? undefined;
        } catch {
          /* 저장소 없으면 매번 새 id */
        }
        const [registered, issuer] = await Promise.all([
          api<MerchantRegistered>('/api/merchant', {
            method: 'POST',
            body: JSON.stringify({
              merchantId: saved,
              verifier: useCase.verifier,
              purpose: useCase.purpose,
              requested,
            }),
          }),
          api<IssuerInfo>('/api/issuer'),
        ]);
        if (cancelled) return;
        try {
          localStorage.setItem(MERCHANT_ID_KEY, registered.merchantId);
        } catch {
          /* 무시 */
        }
        setMerchantId(registered.merchantId);
        setIssuerDid(issuer.did);
        setError('');
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [requested, useCase]);

  useEffect(() => {
    let cancelled = false;
    loadVerifierRegistry()
      .then(({ registry: loaded, info }) => {
        if (cancelled) return;
        setRegistry(loaded);
        setChainInfo(info);
      })
      .catch(() => {
        /* 설정 조회 실패면 서버 스텁 그대로 */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 폴링: 새 제시가 오면 여기서 검증한다
  useEffect(() => {
    if (!merchantId || !issuerDid) return;
    let cancelled = false;

    const buildRows = (sessions: SessionRecord[]): Row[] =>
      sessions
        .slice()
        .sort((a, b) => (b.presentedAt ?? 0) - (a.presentedAt ?? 0))
        .map((session) => ({ session, report: reports.current.get(session.sessionId) }));

    const tick = async () => {
      try {
        // 서버가 재시작되면 메모리의 템플릿이 사라진다. 폴링마다 같은 id 로 다시 등록해
        // 사장님 화면을 새로고침하지 않아도 QR 이 계속 살아 있게 한다 (멱등 upsert).
        await api<MerchantRegistered>('/api/merchant', {
          method: 'POST',
          body: JSON.stringify({ merchantId, verifier: useCase.verifier, purpose: useCase.purpose, requested }),
        });
        const { sessions } = await api<MerchantSessions>(`/api/merchant/${merchantId}/sessions`);
        if (cancelled) return;
        for (const session of sessions) {
          if (!session.vp) continue;
          if (reports.current.has(session.sessionId) || verifying.current.has(session.sessionId)) continue;
          verifying.current.add(session.sessionId);
          void verifier.current
            .verify(session.vp, {
              trustedIssuers: [issuerDid],
              expectedVct: VCT_RESIDENT_ID,
              request: session.request,
              revocationRegistry: registry,
            })
            .then((report) => reports.current.set(session.sessionId, report))
            .catch((e: unknown) => reports.current.set(session.sessionId, rejectedReport((e as Error).message)))
            .finally(() => {
              verifying.current.delete(session.sessionId);
              if (!cancelled) setRows(buildRows(sessions));
            });
        }
        setRows(buildRows(sessions));
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // useCase·requested 가 바뀌면 폴링을 다시 시작해 재등록 본문이 최신 템플릿을 따르게 한다.
  }, [merchantId, issuerDid, useCase, requested, registry]);

  const walletUrl = merchantId ? `${window.location.origin}/wallet?m=${merchantId}` : '';

  useEffect(() => {
    if (!walletUrl) return;
    void QRCode.toDataURL(walletUrl, { margin: 1, width: 640 }).then(setQrSrc);
  }, [walletUrl]);

  useEffect(() => {
    if (!showQr) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowQr(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showQr]);

  /** 사례를 바꾸면 그 용도에 필요한 항목이 기본 체크된다. */
  const selectCase = (id: string) => {
    const next = PURPOSE_CASES.find((item) => item.id === id);
    if (!next) return;
    setUseCase(next);
    setRequested([...next.required]);
  };

  const toggle = (key: string) =>
    setRequested((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));

  const tryOpen = async (row: Row) => {
    const sealed = row.report?.audit.sealed.rrn_sealed;
    if (!sealed) return;
    const attempts = await verifier.current.tryOpenSealed(sealed);
    const failed = attempts.every((attempt) => !attempt.ok);
    setOpenResults((prev) => ({
      ...prev,
      [row.session.sessionId]: failed ? '❌ 복호화 실패. 사장님 키로는 열리지 않습니다' : '열림 (버그)',
    }));
  };

  return (
    <div className="mx-auto flex min-h-full max-w-[880px] flex-col px-8 py-6">
      <header className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="text-[18px] font-semibold">사장님</div>
          <select
            value={useCase.id}
            onChange={(event) => selectCase(event.target.value)}
            className="mt-1 max-w-full rounded-lg border border-line-strong bg-panel px-2.5 py-1.5 text-[14px] outline-none focus:border-ink"
          >
            {PURPOSE_CASES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.verifier} · {item.purpose}
              </option>
            ))}
          </select>
          <div className="mt-1.5 text-[12px] text-ink-dim">{useCase.why}</div>
          <div className="mt-1 text-[12px] text-ink-faint">
            ⛓ 폐기 조회 · {chainInfo ? chainInfo.label : '확인 중'}{chainInfo?.isStub ? ' (스텁, 체인 미연결)' : chainInfo ? ' (이 브라우저가 RPC 를 직접 읽음)' : ''}
          </div>
        </div>
        <PrimaryButton onClick={() => setShowQr(true)} disabled={!qrSrc}>
          QR 띄우기
        </PrimaryButton>
      </header>

      {error ? <div className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-bad">{error}</div> : null}

      {/* 요청할 정보 */}
      <section className="mt-6 rounded-xl border border-line bg-panel px-5 py-4">
        <div className="mb-2 text-[13px] font-semibold text-verifier">알바생에게 요청할 정보</div>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {REQUESTABLE_CLAIMS.map((key) => {
            const descriptor = describeClaim(key);
            const checked = requested.includes(key);
            const isRequired = useCase.required.includes(key);
            return (
              <label key={key} className="flex items-center gap-2 text-[15px]">
                <input type="checkbox" checked={checked} onChange={() => toggle(key)} className="h-4 w-4 accent-ink" />
                {descriptor.label}
                {descriptor.mode === 'sealed' ? <span className="text-[12px] text-sealed">봉인</span> : null}
                {checked && !isRequired ? <span className="text-[12px] text-bad">불필요</span> : null}
                {!checked && isRequired ? <span className="text-[12px] text-verifier">필요</span> : null}
              </label>
            );
          })}
        </div>
        {walletUrl ? (
          <div className="mt-3 flex items-center gap-3 text-[12px] text-ink-faint">
            <span className="mono truncate">{walletUrl}</span>
            <a href={walletUrl} target="_blank" rel="noreferrer" className="shrink-0 text-ink-dim hover:text-ink">
              이 노트북에서 알바생 화면 열기 ↗
            </a>
          </div>
        ) : null}
      </section>

      {/* 들어온 제시 */}
      <section className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[13px] font-semibold text-verifier">들어온 제시</span>
          <span className="text-[13px] text-ink-dim">{rows.length}건</span>
        </div>
        {rows.length === 0 ? (
          <Note>알바생이 QR 을 열고 [제시하기] 를 누르면 여기에 쌓입니다.</Note>
        ) : (
          rows.map((row) => (
            <PresentationRow
              key={row.session.sessionId}
              row={row}
              openResult={openResults[row.session.sessionId]}
              onOpen={() => void tryOpen(row)}
            />
          ))
        )}
      </section>

      {showQr ? <QrOverlay src={qrSrc} url={walletUrl} onClose={() => setShowQr(false)} /> : null}
    </div>
  );
}

function PresentationRow({
  row,
  openResult,
  onOpen,
}: {
  row: Row;
  openResult?: string;
  onOpen: () => void;
}) {
  const { session, report } = row;
  const time = session.presentedAt ? new Date(session.presentedAt).toLocaleTimeString('ko-KR') : '';
  const name = report?.audit.disclosed.find((claim) => claim.key === 'name')?.value;

  return (
    <div className="mb-3 rounded-xl border border-line bg-panel px-5 py-4">
      <div className="flex items-baseline gap-3">
        <span className="text-[17px] font-semibold">{report ? String(name ?? '(성명 미제공)') : '검증 중…'}</span>
        {report ? (
          <span className="text-[13px] font-semibold" style={{ color: report.ok ? 'var(--color-ok)' : 'var(--color-bad)' }}>
            {report.ok ? '통과' : '거부'}
          </span>
        ) : null}
        <span className="truncate text-[12px] text-ink-faint">{session.request.purpose}</span>
        <span className="ml-auto shrink-0 text-[12px] text-ink-faint">{time}</span>
      </div>

      {report ? (
        <>
          {/* 요청한 항목별로: 받은 값 / 🔒 봉인 / 미제공 */}
          <div className="mt-3 flex flex-col">
            {session.request.requested.map((key) => (
              <ClaimLine key={key} claimKey={key} report={report} openResult={openResult} onOpen={onOpen} />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3">
            {groupChecks(report.checks).map((group) => (
              <span key={group.label} className="flex items-center gap-1.5 text-[13px]" title={group.detail}>
                <span style={{ color: group.ok ? 'var(--color-ok)' : 'var(--color-bad)' }}>{group.ok ? '✓' : '✕'}</span>
                {group.label}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function ClaimLine({
  claimKey,
  report,
  openResult,
  onOpen,
}: {
  claimKey: string;
  report: VerificationReport;
  openResult?: string;
  onOpen: () => void;
}) {
  const label = describeClaim(claimKey).label;
  const disclosed = report.audit.disclosed.find((claim) => claim.key === claimKey);
  const sealed = report.audit.sealed[claimKey];

  let value: React.ReactNode;
  if (disclosed) {
    value = typeof disclosed.value === 'boolean' ? (disclosed.value ? '예' : '아니오') : String(disclosed.value);
  } else if (sealed) {
    value = (
      <span className="flex items-center gap-3">
        <span className="text-sealed">🔒 봉인, 열 수 없음</span>
        {openResult ? (
          <span className="text-[13px] text-bad">{openResult}</span>
        ) : (
          <button type="button" onClick={onOpen} className="text-[13px] text-ink-dim underline hover:text-ink">
            열어 보기
          </button>
        )}
      </span>
    );
  } else {
    value = <span className="text-ink-faint">미제공 (알바생이 보내지 않음)</span>;
  }

  return (
    <div className="flex items-baseline gap-4 py-1 text-[14px]">
      <span className="w-[112px] shrink-0 text-ink-dim">{label}</span>
      <span className="min-w-0 flex-1">{value}</span>
    </div>
  );
}

function QrOverlay({ src, url, onClose }: { src: string; url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-panel"
      onClick={onClose}
      role="dialog"
      aria-label="알바생 화면 열기 QR"
    >
      <div className="text-[22px] font-semibold">알바생 화면 열기</div>
      <div className="mt-1 text-[15px] text-ink-dim">폰 카메라로 스캔하세요</div>
      {src ? <img src={src} alt="QR" className="mt-6 h-[min(70vh,70vw)] w-[min(70vh,70vw)]" /> : null}
      <div className="mono mt-5 text-[14px] text-ink-dim">{url}</div>
      <div className="mt-8">
        <SecondaryButton onClick={onClose}>닫기</SecondaryButton>
      </div>
    </div>
  );
}

/** 검증 자체가 예외로 끝나면(형식 오류 등) 거부로 취급한다. */
function rejectedReport(message: string): VerificationReport {
  return {
    ok: false,
    checks: [{ id: 'issuer-signature', label: '주민센터 서명 확인', ok: false, detail: message }],
    audit: { disclosed: [], withheldDigests: [], sealed: {}, alwaysPresent: {} },
  };
}
