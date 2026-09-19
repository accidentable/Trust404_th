/**
 * 폐기 레지스트리 (§9)
 *
 * 체인에 올라가는 것은 **인덱스 번호와 폐기 여부뿐이다. 개인정보는 한 글자도 없다.**
 * 인덱스↔사람 매핑은 발급기관만 안다.
 *
 * 폐기 확인을 발급기관에 물어보면 발급기관이 "이 사람이 지금 어디서 신분증을
 * 쓰는지" 알게 된다. 그걸 막으려고 체인을 쓴다. (발급자-검증자 비연결성)
 *
 * Phase 5 에서는 로컬 스텁으로 둔다. Phase 6 에서 이 인터페이스 뒤에
 * `IssuerRegistry.sol` + viem 구현을 끼운다. 화면은 바뀌지 않는다.
 */
export interface ChainCall {
  kind: 'read' | 'write';
  method: string;
  argument: number;
  result: string;
  /** 쓰기 호출에만 있다. */
  txHash?: string;
  /** 익스플로러 링크. 로컬 스텁에는 없다. */
  explorerUrl?: string;
  at: number;
}

export interface RevocationRegistry {
  /** 체인 바에 표시할 이름. */
  readonly label: string;
  /** 실제 체인인지 로컬 스텁인지. 화면에서 숨기지 않는다. */
  readonly isStub: boolean;
  isRevoked(statusIndex: number): Promise<{ revoked: boolean; call: ChainCall }>;
  revoke(statusIndex: number): Promise<{ call: ChainCall }>;
}

/**
 * Phase 5 용 로컬 스텁 — 메모리 Map 하나.
 *
 * 화면에 "LOCAL STUB" 이라고 그대로 표시한다. 실제 트랜잭션이 아닌 것을
 * 실제인 것처럼 보이게 하지 않는다.
 */
export class LocalRevocationRegistry implements RevocationRegistry {
  readonly label = 'LOCAL STUB · IssuerRegistry';
  readonly isStub = true;
  private readonly revokedIndexes = new Set<number>();

  async isRevoked(statusIndex: number): Promise<{ revoked: boolean; call: ChainCall }> {
    await simulateLatency(220);
    const revoked = this.revokedIndexes.has(statusIndex);
    return {
      revoked,
      call: {
        kind: 'read',
        method: 'isRevoked',
        argument: statusIndex,
        result: String(revoked),
        at: Date.now(),
      },
    };
  }

  async revoke(statusIndex: number): Promise<{ call: ChainCall }> {
    await simulateLatency(900); // 쓰기는 블록에 들어가야 하므로 느리다
    this.revokedIndexes.add(statusIndex);
    return {
      call: {
        kind: 'write',
        method: 'revoke',
        argument: statusIndex,
        result: 'ok',
        txHash: fakeTxHash(),
        at: Date.now(),
      },
    };
  }

  reset(): void {
    this.revokedIndexes.clear();
  }
}

function simulateLatency(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 스텁 표시용. 익스플로러 링크는 붙이지 않는다 — 존재하지 않는 트랜잭션이다. */
function fakeTxHash(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 서버 경유 레지스트리 — 사장님 화면(/merchant)이 쓴다.
 * 서버는 폐기 인덱스 집합만 갖는다. Phase 6 에서 서버 쪽 구현이 체인 조회로 바뀐다.
 */
export class RemoteRevocationRegistry implements RevocationRegistry {
  readonly label = 'REMOTE STUB · IssuerRegistry';
  readonly isStub = true;

  async isRevoked(statusIndex: number): Promise<{ revoked: boolean; call: ChainCall }> {
    const res = await fetch(`/api/revocation/${statusIndex}`);
    if (!res.ok) throw new Error(`폐기 조회 실패 (${res.status})`);
    const { revoked } = (await res.json()) as { revoked: boolean };
    return {
      revoked,
      call: { kind: 'read', method: 'isRevoked', argument: statusIndex, result: String(revoked), at: Date.now() },
    };
  }

  async revoke(statusIndex: number): Promise<{ call: ChainCall }> {
    const res = await fetch(`/api/revocation/${statusIndex}`, { method: 'POST' });
    if (!res.ok) throw new Error(`폐기 기록 실패 (${res.status})`);
    const { txHash } = (await res.json()) as { txHash: string };
    return {
      call: { kind: 'write', method: 'revoke', argument: statusIndex, result: 'ok', txHash, at: Date.now() },
    };
  }
}

// ────────────────────────────────────────────────────────────────────
// 온체인 레지스트리 (Phase 6) — IssuerRegistry.sol 을 viem 으로 읽고 쓴다.
//
// 읽기(isRevoked)는 검증자가 RPC 를 직접 호출한다. 발급기관 서버를 거치지 않으므로
// 발급기관은 누가 어디서 검증했는지 모른다. (§9 발급자-검증자 비연결성)
// 쓰기(revoke)는 발급기관 키가 있어야 한다. 서버(주민센터)만 한다.
// RPC 제공자는 어느 인덱스를 조회했는지 볼 수 있다. 완전한 조회 프라이버시는 아니다. (§15-7)
// ────────────────────────────────────────────────────────────────────

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export const ISSUER_REGISTRY_ABI = [
  { type: 'function', name: 'issuer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'revoked',
    stateMutability: 'view',
    inputs: [{ name: 'index', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
  { type: 'function', name: 'revoke', stateMutability: 'nonpayable', inputs: [{ name: 'index', type: 'uint256' }], outputs: [] },
  {
    type: 'event',
    name: 'Revoked',
    inputs: [
      { name: 'index', type: 'uint256', indexed: true },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
] as const;

/** 서버 환경변수에서 오고, 브라우저는 GET /api/chain 으로 받는다. */
export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  address: `0x${string}`;
  /** 트랜잭션 링크의 앞부분. 예: https://sepolia.etherscan.io/tx/ . 로컬 anvil 은 없음 */
  explorerTxUrl?: string;
  /** 화면 표시용 이름. 예: Sepolia, Anvil(local) */
  networkName: string;
}

function chainFor(config: ChainConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.networkName,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export class OnChainRevocationRegistry implements RevocationRegistry {
  readonly label: string;
  readonly isStub = false;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient | null;
  private readonly chain: Chain;

  /**
   * @param issuerPrivateKey 발급기관의 체인 키. 있으면 revoke 를 쓸 수 있다. 검증자는 넘기지 않는다.
   */
  constructor(
    readonly config: ChainConfig,
    issuerPrivateKey?: Hex,
  ) {
    this.chain = chainFor(config);
    this.label = `${config.networkName} · IssuerRegistry ${config.address.slice(0, 6)}…${config.address.slice(-4)}`;
    this.publicClient = createPublicClient({ chain: this.chain, transport: http(config.rpcUrl) });
    this.walletClient = issuerPrivateKey
      ? createWalletClient({ chain: this.chain, transport: http(config.rpcUrl), account: privateKeyToAccount(issuerPrivateKey) })
      : null;
  }

  async isRevoked(statusIndex: number): Promise<{ revoked: boolean; call: ChainCall }> {
    const revoked = await this.publicClient.readContract({
      address: this.config.address,
      abi: ISSUER_REGISTRY_ABI,
      functionName: 'revoked',
      args: [BigInt(statusIndex)],
    });
    return {
      revoked,
      call: { kind: 'read', method: 'revoked', argument: statusIndex, result: String(revoked), at: Date.now() },
    };
  }

  async revoke(statusIndex: number): Promise<{ call: ChainCall }> {
    if (!this.walletClient?.account) {
      throw new Error('폐기 쓰기에는 발급기관 체인 키(ISSUER_CHAIN_KEY)가 필요합니다');
    }
    const txHash = await this.walletClient.writeContract({
      chain: this.chain,
      account: this.walletClient.account,
      address: this.config.address,
      abi: ISSUER_REGISTRY_ABI,
      functionName: 'revoke',
      args: [BigInt(statusIndex)],
    });
    // 블록에 들어갈 때까지 기다린다. Sepolia 는 십수 초, anvil 은 즉시.
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status !== 'success') throw new Error(`revoke 트랜잭션 실패: ${txHash}`);
    return {
      call: {
        kind: 'write',
        method: 'revoke',
        argument: statusIndex,
        result: `block ${receipt.blockNumber}`,
        txHash,
        ...(this.config.explorerTxUrl ? { explorerUrl: `${this.config.explorerTxUrl}${txHash}` } : {}),
        at: Date.now(),
      },
    };
  }
}
