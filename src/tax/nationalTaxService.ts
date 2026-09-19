import type { JWK } from 'jose';
import {
  generateX25519KeyPair,
  privateJwkFromX25519,
  publicJwkFromX25519,
  type X25519KeyPair,
} from '../shared/keys';
import { unseal, type JweCompact, type UnsealResult } from '../shared/sealing';

/**
 * 국세청
 *
 * Issuer 도 Verifier 도 아니다. **봉인 수신자**다. (§6)
 * 검증하지 않고 복호화만 한다.
 *
 * 국세청이 검증까지 하면 국세청이 "이 사람이 언제 어디서 일했는지"를 알게 되어
 * 구조가 무너진다. 그리고 사장님은 그 자리에서 판단해야 하고, 신고는 다음 달이다.
 *
 * 프로토타입 한계: 실제로 동작하려면 홈택스가 이 봉인 포맷을 수용해야 한다.
 * 여기 있는 것은 국세청 목업이다. (§15-2)
 */
export class NationalTaxService {
  readonly name = '국세청';
  readonly did: string;
  private readonly keyPair: X25519KeyPair;

  constructor(keyPair: X25519KeyPair = generateX25519KeyPair()) {
    this.keyPair = keyPair;
    this.did = keyPair.did;
  }

  /**
   * 공개키 — 주민센터가 봉인할 때 쓴다. 공개되어도 된다.
   * 공개키로는 봉인을 만들 수만 있고 열 수는 없다.
   */
  get publicJwk(): JWK {
    return publicJwkFromX25519(this.keyPair.publicKey);
  }

  /** 개인키 — 이 객체 밖으로 나가지 않는다. 사장님은 이 값을 가질 수 없다. */
  private get privateJwk(): JWK {
    return privateJwkFromX25519(this.keyPair);
  }

  /** 봉인을 연다. 국세청만 성공한다. */
  async unsealRrn(sealed: JweCompact): Promise<UnsealResult> {
    return unseal(sealed, this.privateJwk);
  }
}
