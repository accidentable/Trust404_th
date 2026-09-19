import { useState } from 'react';
import { api, type IssuerIssueResponse } from '../../shared/api';
import type { ChainCall } from '../../shared/revocation';
import { Note, PrimaryButton, SecondaryButton } from '../components/primitives';
import {
  Badge,
  Card,
  CredentialSummary,
  ErrorBar,
  Field,
  JsonDetails,
  ROLE_COLOR,
  Result,
  RoleShell,
} from '../components/roleParts';

/**
 * 1. 주민센터 (/issuer)
 * 번호를 찍으면 발급한다. 비우면 더미 값. 발급 결과의 holderId 가 다음 단계(/holder?h=)로 넘어간다.
 */
export function IssuerPage() {
  const [form, setForm] = useState({ name: '', birthDate: '', rrn: '' });
  const [issued, setIssued] = useState<IssuerIssueResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const holderId = issued?.holderId ?? undefined;
  const statusIndex = Number(issued?.credential.plaintext.statusIndex);

  // 분실 신고 = 폐기. 레지스트리(체인 또는 스텁)에 인덱스 번호만 기록한다.
  const [revoke, setRevoke] = useState<{ call: ChainCall; registry: string }>();
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState('');

  const revokeCredential = async () => {
    if (!Number.isInteger(statusIndex)) return;
    setRevoking(true);
    try {
      setRevoke(
        await api<{ call: ChainCall; registry: string }>('/api/issuer/revoke', {
          method: 'POST',
          body: JSON.stringify({ statusIndex }),
        }),
      );
      setRevokeError('');
    } catch (e) {
      setRevokeError((e as Error).message);
    } finally {
      setRevoking(false);
    }
  };

  const issue = async () => {
    setBusy(true);
    try {
      const subject: Record<string, string> = {};
      if (form.name.trim()) subject.name = form.name.trim();
      if (form.birthDate.trim()) subject.birthDate = form.birthDate.trim();
      if (form.rrn.trim()) subject.rrn = form.rrn.trim();
      setIssued(await api<IssuerIssueResponse>('/api/issuer/issue', { method: 'POST', body: JSON.stringify({ subject }) }));
      setRevoke(undefined);
      setRevokeError('');
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <RoleShell
      step="01"
      role="주민센터"
      color={ROLE_COLOR.issuer}
      endpoint="POST /api/issuer/issue"
      next={{ label: '지갑', href: holderId ? `/holder?h=${holderId}` : undefined }}
    >
      <Card>
        <Note>번호를 찍으면 발급합니다. 비우면 더미 값이 채워집니다. 사진을 올리는 단계는 없습니다.</Note>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <Field label="성명" value={form.name} placeholder="홍길동" onChange={(v) => setForm({ ...form, name: v })} />
          <Field label="생년월일" value={form.birthDate} placeholder="2001-03-14" onChange={(v) => setForm({ ...form, birthDate: v })} />
          <Field label="주민등록번호" value={form.rrn} placeholder="010314-3000000" onChange={(v) => setForm({ ...form, rrn: v })} />
        </div>
        <div className="mt-3 flex justify-end">
          <PrimaryButton busy={busy} onClick={() => void issue()}>
            발급
          </PrimaryButton>
        </div>
        <ErrorBar message={error} />

        {issued ? (
          <Result>
            <div className="flex flex-wrap items-center gap-3">
              <Badge ok={!issued.plaintextRrnInCredential}>
                {issued.plaintextRrnInCredential ? '평문 주민번호가 들어 있음' : '평문 주민번호 없음'}
              </Badge>
              <span className="text-[13px] text-ink-dim">
                입력 {issued.input.name} · {issued.input.birthDate} · {issued.input.rrn}
              </span>
            </div>
            <CredentialSummary credential={issued.credential} />

            {/* 분실 신고 = 폐기. 체인이면 트랜잭션, 스텁이면 메모리. 화면은 같다. */}
            <div className="mt-3 border-t border-line pt-3">
              <div className="flex items-center justify-between gap-4">
                <div className="text-[13px] text-ink-dim">
                  분실 신고를 하면 레지스트리에 폐기 인덱스 {Number.isInteger(statusIndex) ? statusIndex : '?'} 만 올라갑니다. 이름도 번호도 올라가지 않습니다.
                </div>
                <SecondaryButton onClick={() => void revokeCredential()} disabled={revoking || revoke !== undefined}>
                  {revoking ? '기록 중…' : revoke ? '폐기됨' : '분실 신고 (폐기)'}
                </SecondaryButton>
              </div>
              <ErrorBar message={revokeError} />
              {revoke ? (
                <div className="mt-2">
                  <Badge ok>{`revoke(${revoke.call.argument}) → ${revoke.call.result}`}</Badge>
                  <div className="mono mt-1 text-[12px] text-ink-dim">{revoke.registry}</div>
                  {revoke.call.txHash ? (
                    <div className="mono mt-1 break-all text-[12px] text-ink-dim">
                      tx {revoke.call.txHash}
                      {revoke.call.explorerUrl ? (
                        <>
                          {' · '}
                          <a href={revoke.call.explorerUrl} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                            익스플로러에서 보기
                          </a>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-1 text-[12px] text-ink-dim">사장님이 다시 검증하면 "폐기 여부 확인"에서 걸립니다.</div>
                </div>
              ) : null}
            </div>

            <JsonDetails value={issued} />
          </Result>
        ) : null}
      </Card>
    </RoleShell>
  );
}
