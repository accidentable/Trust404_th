import { useEffect, useMemo, useState } from 'react';
import { HolderWallet } from '../../holder/wallet';
import { loadOrCreateHolderKeyPair } from '../../holder/keyStorage';
import {
  forgetCredential,
  loadPersistedCredential,
  persistCredential,
} from '../../holder/credentialStorage';
import { api, type IssueResponse, type IssuerInfo, type SessionCreated } from '../../shared/api';
import { nowInSeconds } from '../../shared/schema';
import type { StoredCredential } from '../../shared/types';
import { WalletApprovalScreen } from '../screens/WalletApprovalScreen';
import { Note, PrimaryButton } from '../components/primitives';

/**
 * 관객 폰 지갑 (/wallet?m=<merchantId>)
 *
 * 첫 진입: 키쌍 자동 생성(IndexedDB) → 신분증 자동 발급 ("관객N", 더미 주민번호)
 * 그 다음: 사장님 요청을 받아 3칸 승인 화면 → [제시하기]
 *
 * 개인정보 입력 필드는 없다. 개인키는 이 폰 밖으로 나가지 않는다.
 */
type Phase =
  | 'loading'
  | 'issuing'
  | 'no-merchant'
  | 'ready'
  | 'presenting'
  | 'done'
  | 'rejected'
  | 'error';

export function WalletPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [message, setMessage] = useState('');
  const [wallet, setWallet] = useState<HolderWallet>();
  const [stored, setStored] = useState<StoredCredential>();
  const [name, setName] = useState('');
  const [session, setSession] = useState<SessionCreated>();
  const [denied, setDenied] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const merchantId = new URLSearchParams(window.location.search).get('m');
        const { keyPair } = await loadOrCreateHolderKeyPair();
        const holder = new HolderWallet(keyPair);
        const issuer = await api<IssuerInfo>('/api/issuer');

        // 저장된 신분증이 있으면 재사용.
        // 발급기관이 바뀌었거나, 발급 형식 버전이 다르거나, 만료가 임박하면 다시 발급.
        let persisted = await loadPersistedCredential();
        let saved = persisted ? await holder.save(persisted.credential) : undefined;
        const stale =
          !persisted ||
          persisted.issuerDid !== issuer.did ||
          persisted.version !== issuer.version ||
          (saved !== undefined && saved.expiresAt < nowInSeconds() + 5 * 60);

        if (stale) {
          if (cancelled) return;
          setPhase('issuing');
          await forgetCredential();
          const issued = await api<IssueResponse>('/api/issue', {
            method: 'POST',
            body: JSON.stringify({ holderPublicJwk: holder.publicJwk }),
          });
          persisted = {
            credential: issued.credential,
            name: issued.name,
            issuerDid: issued.issuerDid,
            version: issued.version,
          };
          await persistCredential(persisted);
          saved = await holder.save(persisted.credential);
        }
        if (cancelled || !saved || !persisted) return;

        setWallet(holder);
        setStored(saved);
        setName(persisted.name);

        if (!merchantId) {
          setPhase('no-merchant');
          return;
        }
        const created = await api<SessionCreated>('/api/session', {
          method: 'POST',
          body: JSON.stringify({ merchantId }),
        });
        if (cancelled) return;
        setSession(created);
        setPhase('ready');
      } catch (error) {
        if (!cancelled) {
          setMessage((error as Error).message);
          setPhase('error');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const plan = useMemo(
    () =>
      wallet && stored && session
        ? wallet.reviewRequest(stored.id, session.request, { deny: denied })
        : undefined,
    [wallet, stored, session, denied],
  );

  async function present() {
    if (!wallet || !stored || !session || !plan) return;
    setPhase('presenting');
    try {
      const vp = await wallet.presentPlan(stored.id, plan);
      await api<{ ok: boolean }>(`/api/session/${session.sessionId}/vp`, {
        method: 'POST',
        body: JSON.stringify({ vp }),
      });
      setPhase('done');
    } catch (error) {
      setMessage((error as Error).message);
      setPhase('error');
    }
  }

  const toggleDeny = (key: string) =>
    setDenied((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]));

  return (
    <div className="mx-auto flex min-h-full max-w-[420px] flex-col px-5 py-6">
      <header className="mb-5 flex items-baseline gap-2">
        <span className="text-[16px] font-semibold">알바생: {name || '…'}</span>
      </header>

      {stored ? (
        <div className="rounded-xl border border-line bg-panel px-5 py-4">
          <div className="text-[12px] text-ink-dim">주민등록 확인 · 시연용</div>
          <div className="mt-1 text-[22px] font-semibold">{String(stored.selectiveClaims.name ?? '')}</div>
          <div className="mt-1 text-[13px] text-ink-dim">
            만 18세 이상 · {stored.selectiveClaims.isOver18 ? '예' : '아니오'} · 주민등록번호 🔒 봉인
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-1 flex-col">
        {phase === 'loading' ? <Note>지갑을 여는 중…</Note> : null}
        {phase === 'issuing' ? <Note>주민센터에서 신분증을 발급받는 중…</Note> : null}
        {phase === 'no-merchant' ? <Note>사장님 화면의 QR 로 열어 주세요.</Note> : null}
        {phase === 'rejected' ? <Note>거부했습니다. 아무것도 전송되지 않았습니다.</Note> : null}

        {(phase === 'ready' || phase === 'presenting' || phase === 'done') && plan ? (
          <div className="rounded-xl border border-line bg-panel px-5 py-5">
            <WalletApprovalScreen
              plan={plan}
              onToggleDeny={toggleDeny}
              onPresent={() => void present()}
              onReject={() => setPhase('rejected')}
              presented={phase === 'done'}
              busy={phase === 'presenting'}
            />
            {phase === 'done' ? <Note>사장님 화면에 올라갔는지 확인하세요.</Note> : null}
          </div>
        ) : null}

        {phase === 'error' ? (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-bad">{message}</div>
            <PrimaryButton onClick={() => window.location.reload()}>다시 시도</PrimaryButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
