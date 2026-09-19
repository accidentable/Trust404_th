import type { Hex } from 'viem';
import {
  LocalRevocationRegistry,
  OnChainRevocationRegistry,
  type ChainConfig,
  type RevocationRegistry,
} from '../src/shared/revocation';

/**
 * 폐기 레지스트리 선택 (Phase 6)
 *
 * 환경변수가 있으면 체인, 없으면 메모리 스텁. 화면과 API 는 어느 쪽이든 같은 인터페이스를 쓴다.
 *
 *   REGISTRY_ADDRESS   IssuerRegistry 컨트랙트 주소 (0x…)
 *   RPC_URL            체인 RPC. 브라우저도 이 주소로 직접 읽는다 (CORS 되는 공개 RPC 여야 한다)
 *   CHAIN_ID           11155111 (Sepolia) · 31337 (anvil)
 *   ISSUER_CHAIN_KEY   발급기관의 체인 개인키 (0x…). 컨트랙트를 배포한 키. revoke 쓰기에만 쓴다
 */
const KNOWN_CHAINS: Record<number, { name: string; explorerTxUrl?: string }> = {
  11155111: { name: 'Sepolia', explorerTxUrl: 'https://sepolia.etherscan.io/tx/' },
  // Sepolia faucet 이 막히면 아래 테스트넷 아무거나 써도 된다. 컨트랙트와 코드는 그대로다.
  80002: { name: 'Polygon Amoy', explorerTxUrl: 'https://amoy.polygonscan.com/tx/' },
  84532: { name: 'Base Sepolia', explorerTxUrl: 'https://sepolia.basescan.org/tx/' },
  421614: { name: 'Arbitrum Sepolia', explorerTxUrl: 'https://sepolia.arbiscan.io/tx/' },
  11155420: { name: 'Optimism Sepolia', explorerTxUrl: 'https://sepolia-optimism.etherscan.io/tx/' },
  31337: { name: 'Anvil (local)' },
};

export function chainConfigFromEnv(): ChainConfig | null {
  const address = process.env.REGISTRY_ADDRESS;
  const rpcUrl = process.env.RPC_URL;
  const chainId = Number(process.env.CHAIN_ID);
  if (!address || !rpcUrl || !Number.isInteger(chainId)) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('REGISTRY_ADDRESS 는 0x + 40자리 hex 여야 합니다');
  const known = KNOWN_CHAINS[chainId];
  return {
    chainId,
    rpcUrl,
    address: address as `0x${string}`,
    networkName: known?.name ?? `chain ${chainId}`,
    ...(known?.explorerTxUrl ? { explorerTxUrl: known.explorerTxUrl } : {}),
  };
}

export interface RegistrySetup {
  /** 발급기관용. 쓰기 가능 (체인 키가 있을 때). */
  issuerRegistry: RevocationRegistry;
  /** 검증자용 읽기 전용. 서버 안의 /api/revocation 과 역할 API 가 쓴다. */
  verifierRegistry: RevocationRegistry;
  chain: ChainConfig | null;
}

export function setupRegistry(): RegistrySetup {
  const chain = chainConfigFromEnv();
  if (!chain) {
    const stub = new LocalRevocationRegistry();
    return { issuerRegistry: stub, verifierRegistry: stub, chain: null };
  }
  const key = process.env.ISSUER_CHAIN_KEY;
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('ISSUER_CHAIN_KEY 는 0x + 64자리 hex 여야 합니다');
  return {
    issuerRegistry: new OnChainRevocationRegistry(chain, key as Hex | undefined),
    verifierRegistry: new OnChainRevocationRegistry(chain),
    chain,
  };
}
