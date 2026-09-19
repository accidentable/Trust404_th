import { useEffect, useState } from 'react';
import { api, type HolderViewResponse } from '../../shared/api';
import { shortenDid } from '../../shared/did';
import { Note, Row } from '../components/primitives';
import {
  Card,
  CredentialSummary,
  ErrorBar,
  JsonDetails,
  NeedPrevious,
  ROLE_COLOR,
  RoleShell,
  queryParam,
} from '../components/roleParts';

/**
 * 2. 나 (/holder?h=<holderId>)
 * 지갑이 보관 중인 것을 보여준다. 열리면서 바로 불러온다. 다음 단계는 /verifier?h= 로 이어진다.
 * 이 페이지의 지갑은 서버가 대신 든다(내용 확인용). 폰 흐름(/wallet)에서는 키가 폰에만 있다.
 */
export function HolderPage() {
  const holderId = queryParam('h');
  const [holder, setHolder] = useState<HolderViewResponse>();
  const [error, setError] = useState('');

  useEffect(() => {
    if (!holderId) return;
    let cancelled = false;
    void api<HolderViewResponse>(`/api/holder/${holderId}`)
      .then((res) => {
        if (!cancelled) setHolder(res);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [holderId]);

  const latest = holder?.credentials.at(-1);

  return (
    <RoleShell
      step="02"
      role="나"
      color={ROLE_COLOR.holder}
      endpoint={`GET /api/holder/${holderId ?? ':holderId'}`}
      prev={{ label: '주민센터', href: '/issuer' }}
      next={{ label: '사장님', href: holderId ? `/verifier?h=${holderId}` : undefined }}
    >
      {!holderId ? (
        <NeedPrevious what="보여줄 지갑이 없습니다. 먼저 주민센터에서 발급받으세요." href="/issuer" label="주민센터에서 발급받기" />
      ) : (
        <Card>
          <Note>지갑이 보관 중인 것입니다. 이 페이지의 지갑은 서버가 대신 듭니다. 폰 흐름에서는 키가 폰에만 있습니다.</Note>
          <ErrorBar message={error} />
          {holder ? (
            <div className="mt-4">
              <Row label="내 DID" value={<span className="mono">{shortenDid(holder.did, 22, 8)}</span>} />
              <Row label="자격증명" value={`${holder.credentials.length}장 보관 중`} />
              <Row label="개인키" value={<span className="text-ink-dim">{holder.privateKey}</span>} />
              {latest ? <CredentialSummary credential={latest} /> : null}
              <JsonDetails value={holder} />
            </div>
          ) : !error ? (
            <div className="mt-4 text-[13px] text-ink-faint">불러오는 중…</div>
          ) : null}
        </Card>
      )}
    </RoleShell>
  );
}
