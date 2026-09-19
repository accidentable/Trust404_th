import { useState } from 'react';
import { api, type TaxUnsealResponse } from '../../shared/api';
import { Note, PrimaryButton, Row } from '../components/primitives';
import { Card, ErrorBar, JsonDetails, NeedPrevious, ROLE_COLOR, Result, RoleShell, queryParam } from '../components/roleParts';

/**
 * 4. 국세청 (/tax?s=<sessionId>)
 * 사장님이 신고서에 그대로 첨부한 봉인을 국세청 개인키로 연다. 지급명세서가 만들어진다.
 */
export function TaxPage() {
  const sessionId = queryParam('s');
  const [unsealed, setUnsealed] = useState<TaxUnsealResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const unseal = async () => {
    setBusy(true);
    try {
      setUnsealed(await api<TaxUnsealResponse>('/api/tax/unseal', { method: 'POST', body: JSON.stringify({ sessionId }) }));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RoleShell
      step="04"
      role="국세청"
      color={ROLE_COLOR.tax}
      endpoint="POST /api/tax/unseal"
      prev={{ label: '사장님', href: sessionId ? `/verifier?s=${sessionId}` : '/verifier' }}
    >
      {!sessionId ? (
        <NeedPrevious what="열어 볼 봉인이 없습니다. 먼저 사장님 페이지에서 제시를 받으세요." href="/verifier" label="사장님 페이지로" />
      ) : (
        <Card>
          <Note>사장님이 그대로 첨부한 봉인을 국세청 개인키로 엽니다. 지급명세서가 만들어집니다.</Note>
          <div className="mt-3 flex justify-end">
            <PrimaryButton busy={busy} onClick={() => void unseal()}>
              봉인 열기
            </PrimaryButton>
          </div>
          <ErrorBar message={error} />

          {unsealed ? (
            <Result>
              <div className="flex items-baseline gap-3">
                <span className="text-[16px]">🔓</span>
                <span className="mono text-[22px] font-semibold tracking-wider">{unsealed.rrn}</span>
                <span className="text-[12px] text-ink-dim">
                  {unsealed.seal.algorithm} · {unsealed.seal.encryption}
                </span>
              </div>
              <div className="mt-3 border-t border-line pt-2">
                {Object.entries(unsealed.statement).map(([k, v]) => (
                  <Row key={k} label={k} value={typeof v === 'number' ? v.toLocaleString('ko-KR') : String(v)} />
                ))}
              </div>
              <JsonDetails value={unsealed} />
            </Result>
          ) : null}
        </Card>
      )}
    </RoleShell>
  );
}
