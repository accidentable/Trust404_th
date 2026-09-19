import type { MerchantRecord, SessionRecord } from '../src/shared/api';

/**
 * 세션 저장소 — 메모리 Map.
 *
 * 단일 인스턴스 배포를 전제한다. 서버리스(인스턴스가 여럿)로 가려면
 * 이 인터페이스 뒤에 KV 구현을 끼운다. 라우트 코드는 바뀌지 않는다.
 */
export interface SessionStore {
  put(record: SessionRecord): void;
  get(sessionId: string): SessionRecord | undefined;
  listByMerchant(merchantId: string): SessionRecord[];
}

export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();

  constructor(private readonly ttlMs: number) {}

  put(record: SessionRecord): void {
    this.sweep();
    this.sessions.set(record.sessionId, record);
  }

  get(sessionId: string): SessionRecord | undefined {
    this.sweep();
    return this.sessions.get(sessionId);
  }

  listByMerchant(merchantId: string): SessionRecord[] {
    this.sweep();
    return [...this.sessions.values()]
      .filter((session) => session.merchantId === merchantId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, session] of this.sessions) {
      if (session.createdAt < cutoff) this.sessions.delete(id);
    }
  }
}

export class MemoryStore {
  readonly sessions: MemorySessionStore;
  readonly merchants = new Map<string, MerchantRecord>();
  /** Phase 6 전까지의 폐기 스텁 — 인덱스 번호만 갖는다. 개인정보 없음. */
  readonly revoked = new Set<number>();

  constructor(sessionTtlMs: number) {
    this.sessions = new MemorySessionStore(sessionTtlMs);
  }
}
