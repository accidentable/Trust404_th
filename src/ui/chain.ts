import { api } from '../shared/api';
import {
  OnChainRevocationRegistry,
  RemoteRevocationRegistry,
  type ChainConfig,
  type RevocationRegistry,
} from '../shared/revocation';

/** GET /api/chain 응답. */
export interface ChainInfo {
  configured: boolean;
  chain: ChainConfig | null;
  label: string;
  isStub: boolean;
}

export function loadChainInfo(): Promise<ChainInfo> {
  return api<ChainInfo>('/api/chain');
}

/**
 * 사장님 브라우저용 폐기 레지스트리.
 *
 * 체인이 설정돼 있으면 이 브라우저가 RPC 를 **직접** 읽는다. 우리 서버는 발급기관 키를 들고 있으므로
 * 서버에 물으면 발급기관이 "누가 어디서 검증했는지" 알게 된다. 그걸 피하려고 체인을 쓴다. (§9)
 * 설정이 없으면 서버 스텁으로 떨어진다. 화면에 스텁이라고 표시된다.
 */
export async function loadVerifierRegistry(): Promise<{ registry: RevocationRegistry; info: ChainInfo }> {
  const info = await loadChainInfo();
  const registry = info.configured && info.chain ? new OnChainRevocationRegistry(info.chain) : new RemoteRevocationRegistry();
  return { registry, info };
}
