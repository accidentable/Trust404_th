import { useState } from 'react';
import {
  api,
  type HolderPresentResponse,
  type VerifierOpenResponse,
  type VerifierResponse,
} from '../../shared/api';
import { describeClaim } from '../../shared/schema';
import { CheckLine, Note, PrimaryButton, Row, SecondaryButton } from '../components/primitives';
import {
  Badge,
  Bucket,
  Card,
  ErrorBar,
  JsonDetails,
  NeedPrevious,
  ROLE_COLOR,
  Result,
  RoleShell,
  fmt,
  queryParam,
  setQuery,
} from '../components/roleParts';
import { MERCHANT_ID_KEY } from './MerchantPage';

/**
 * 3. 사장님 (/verifier?h=<holderId>&s=<sessionId>)
 *
 * 지갑(h)에게 제시를 받고 → 검증하고 → 봉인을 열어 본다(실패). 검증은 사장님 쪽 코드가 한다.
 * 제시가 만들어지면 s 가 URL 에 붙어 새로고침해도 이어지고, 다음 단계 /tax?s= 로 넘어간다.
 * 실제 QR 화면은 /merchant. 여기는 그 검증 결과를 내용까지 풀어 보는 페이지다.
 */
export function VerifierPage() {
  const holderId = queryParam('h');
  const [sessionId, setSessionId] = useState<string | undefined>(() => queryParam('s'));
  const [presented, setPresented] = useState<HolderPresentResponse>();
  const [verified, setVerified] = useState<VerifierResponse>();
  const [opened, setOpened] = useState<VerifierOpenResponse>();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [merchantId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(MERCHANT_ID_KEY);
    } catch {
      return null;
    }
  });
  const [sendToMerchant, setSendToMerchant] = useState(false);

  const run = async (label: string, task: () => Promise<void>) => {
    setBusy(label);
    try {
      await task();
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const present = () =>
    run('제시', async () => {
      const res = await api<HolderPresentResponse>(`/api/holder/${holderId}/present`, {
        method: 'POST',
        body: JSON.stringify(sendToMerchant && merchantId ? { merchantId } : {}),
      });
      setPresented(res);
      setVerified(undefined);
      setOpened(undefined);
      setSessionId(res.sessionId);
      setQuery({ s: res.sessionId });
    });

  const verify = () => run('검증', async () => setVerified(await api<VerifierResponse>(`/api/verifier/${sessionId}`)));

  const open = () =>
    run('열어 보기', async () =>
      setOpened(await api<VerifierOpenResponse>(`/api/verifier/${sessionId}/open`, { method: 'POST', body: '{}' })),
    );

  return (
    <RoleShell
      step="03"
      role="사장님"
      color={ROLE_COLOR.verifier}
      endpoint={`POST /api/holder/${holderId ?? ':holderId'}/present  →  GET /api/verifier/${sessionId ?? ':sessionId'}`}
      prev={{ label: '지갑', href: holderId ? `/holder?h=${holderId}` : '/holder' }}
      next={{ label: '국세청', href: sessionId ? `/tax?s=${sessionId}` : undefined }}
    >
      {!holderId && !sessionId ? (
        <NeedPrevious what="제시를 받을 지갑이 없습니다. 먼저 주민센터에서 발급받으세요." href="/issuer" label="주민센터에서 발급받기" />
      ) : (
        <Card>
          <Note>지갑이 제시하고, 사장님이 검증합니다. 검증은 서버가 아니라 사장님 쪽 코드가 합니다.</Note>
          {merchantId && holderId ? (
            <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-dim">
              <input
                type="checkbox"
                checked={sendToMerchant}
                onChange={(e) => setSendToMerchant(e.target.checked)}
                className="h-4 w-4 accent-ink"
              />
              사장님 화면(/merchant) 목록에도 보내기
            </label>
          ) : null}
          <div className="mt-3 flex flex-wrap justify-end gap-3">
            <PrimaryButton disabled={!holderId} busy={busy === '제시'} onClick={() => void present()}>
              제시 받기
            </PrimaryButton>
            <SecondaryButton disabled={!sessionId || busy !== null} onClick={() => void verify()}>
              검증
            </SecondaryButton>
            <SecondaryButton disabled={!sessionId || busy !== null} onClick={() => void open()}>
              봉인 열어 보기
            </SecondaryButton>
          </div>
          <ErrorBar message={error} />

          {presented ? (
            <Result title="제시 (지갑 → 사장님)">
              <Row label="요청" value={`${presented.request.verifier} · ${presented.request.purpose}`} />
              <Bucket color={ROLE_COLOR.holder} title="보여줄 정보">
                {presented.sent.shown.length ? presented.sent.shown.map((i) => `${i.label} ${fmt(i.value)}`).join(' · ') : '없음'}
              </Bucket>
              <Bucket color="var(--color-sealed)" title="잠긴 채 전달">
                {presented.sent.sealed.length ? presented.sent.sealed.map((i) => `🔒 ${i.label}`).join(' · ') : '없음'}
              </Bucket>
              <Bucket color="var(--color-ink-faint)" title="보내지 않음">
                {presented.sent.withheld.length ? presented.sent.withheld.map((i) => i.label).join(' · ') : '없음'}
              </Bucket>
              {presented.presentation.keyBindingJwt ? (
                <Row
                  label="본인 서명"
                  value={
                    <span className="mono text-[12px] text-ink-dim">
                      nonce {presented.presentation.keyBindingJwt.nonce} · aud {presented.presentation.keyBindingJwt.aud}
                    </span>
                  }
                />
              ) : null}
              <JsonDetails value={presented} />
            </Result>
          ) : null}

          {verified ? (
            <Result title="검증">
              <Badge ok={verified.ok}>{verified.ok ? '검증 통과' : '검증 거부'}</Badge>
              <div className="mt-1">
                {verified.summary.map((g) => (
                  <CheckLine key={g.label} ok={g.ok} label={g.label} detail={g.detail} />
                ))}
              </div>
              <div className="mt-2 border-t border-line pt-2">
                <div className="mb-1 text-[12px] font-semibold text-ink-dim">사장님이 본 것</div>
                {verified.sees.disclosed.map((d) => (
                  <Row key={d.key} label={describeClaim(d.key).label} value={fmt(d.value)} />
                ))}
                {Object.keys(verified.sees.sealed).map((k) => (
                  <Row key={k} label={describeClaim(k).label} value={<span className="text-sealed">🔒 봉인, 열 수 없음</span>} />
                ))}
                <Row
                  label="그 외"
                  value={
                    <span className="text-ink-faint">
                      해시만 남은 항목 {verified.sees.withheldDigests.length}개, 이름도 값도 알 수 없음
                    </span>
                  }
                />
                {verified.requestSatisfied ? (
                  <Row
                    label="요청 충족"
                    value={
                      verified.requestSatisfied.satisfied
                        ? '요청한 항목을 모두 받음'
                        : `못 받은 항목: ${verified.requestSatisfied.missing.map((k) => describeClaim(k).label).join(', ')}`
                    }
                  />
                ) : null}
              </div>
              <JsonDetails value={verified} />
            </Result>
          ) : null}

          {opened ? (
            <Result title="봉인 열어 보기">
              <Badge ok={!opened.opened}>{opened.opened ? '열림 (버그)' : '복호화 실패, 사장님 키로는 열리지 않음'}</Badge>
              <div className="mt-1">
                {opened.attempts.map((a) => (
                  <CheckLine key={a.key} ok={a.ok} label={a.key} detail={a.error} />
                ))}
              </div>
              <JsonDetails value={opened} />
            </Result>
          ) : null}
        </Card>
      )}
    </RoleShell>
  );
}
