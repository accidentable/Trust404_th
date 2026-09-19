import type { JWK } from 'jose';
import type { SDJwtVcInstance } from '@sd-jwt/sd-jwt-vc';
import { createIssuerSdJwt } from '../shared/sdjwt';
import { createSigner, generateEd25519KeyPair, type Ed25519KeyPair } from '../shared/keys';
import {
  RESIDENT_ID_SELECTIVE_CLAIMS,
  RESIDENT_ID_TTL_SECONDS,
  VCT_RESIDENT_ID,
  nowInSeconds,
} from '../shared/schema';
import type { ResidentIdSubject, SdJwtCompact } from '../shared/types';
import { seal } from '../shared/sealing';
import { assignStatusIndex } from './statusIndex';

/** 봉인 헤더에 남는 수신자 표시. 사장님 화면의 "🔒 국세청만 열 수 있음"이 이 값이다. */
export const TAX_AUTHORITY_AUDIENCE = '국세청';

export interface IssueResidentIdOptions {
  /** 홀더 공개키. `cnf` 에 박혀서 "이 VC 는 이 지갑 것"을 고정한다. (§8-3) */
  holderPublicJwk: JWK;
  /**
   * 국세청 X25519 공개키. 주민등록번호를 이 키로 봉인해 `rrn_sealed` 에 넣는다.
   * 주민센터는 봉인만 하고, 봉인 후에는 자기도 열 수 없다. (§8-2)
   */
  taxAuthorityPublicJwk: JWK;
  /** 공격 시연(§12)에서 만료된 VC 를 만들기 위해 음수로 넘긴다. */
  ttlSeconds?: number;
  issuedAt?: number;
}

export interface IssuedResidentId {
  credential: SdJwtCompact;
  statusIndex: number;
  /** 화면·로그 표시용. VC 안에도 같은 값이 들어 있다. */
  rrnSealed: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * 주민센터 (Issuer)
 *
 * 이미 주민센터 DB 에 있는 값을 VC 로 서명해 발급한다.
 * 신분증을 촬영해 올리는 단계는 존재하지 않는다. (§11)
 */
export class ResidentCenterIssuer {
  readonly did: string;
  readonly name = '주민센터';
  private readonly keyPair: Ed25519KeyPair;
  private readonly sdjwt: SDJwtVcInstance;

  constructor(keyPair: Ed25519KeyPair = generateEd25519KeyPair()) {
    this.keyPair = keyPair;
    this.did = keyPair.did;
    this.sdjwt = createIssuerSdJwt(createSigner(keyPair.privateKey));
  }

  get publicKey(): Uint8Array {
    return this.keyPair.publicKey;
  }

  async issueResidentId(
    subject: ResidentIdSubject,
    options: IssueResidentIdOptions,
  ): Promise<IssuedResidentId> {
    const issuedAt = options.issuedAt ?? nowInSeconds();
    const expiresAt = issuedAt + (options.ttlSeconds ?? RESIDENT_ID_TTL_SECONDS);
    const statusIndex = assignStatusIndex();

    // 생년월일에서 파생한다. 홀더가 birthDate 를 숨기고 isOver18 만 보여줄 수 있는
    // 이유가 여기 있다 — 나이 판정을 발급 시점에 이미 끝내 둔다.
    const isOver18 = calculateIsOver18(subject.birthDate, issuedAt);

    // 주민등록번호는 여기서 한 번 봉인되고, 그 뒤로 평문으로 존재하지 않는다.
    const rrnSealed = await seal(subject.rrn, options.taxAuthorityPublicJwk, {
      audience: TAX_AUTHORITY_AUDIENCE,
      purpose: 'resident-registration-number',
    });

    const payload = {
      iss: this.did,
      iat: issuedAt,
      exp: expiresAt,
      vct: VCT_RESIDENT_ID,
      cnf: { jwk: options.holderPublicJwk },
      statusIndex,
      // 선택적 공개 대상이 아니다 — 골라서 뺄 수 없고, 대신 검증자도 열 수 없다.
      rrn_sealed: rrnSealed,
      name: subject.name,
      address: subject.address,
      isOver18,
      birthDate: subject.birthDate,
    };

    const credential = await this.sdjwt.issue(payload, {
      _sd: [...RESIDENT_ID_SELECTIVE_CLAIMS],
    });

    return { credential, statusIndex, rrnSealed, issuedAt, expiresAt };
  }
}

export function calculateIsOver18(birthDate: string, atEpochSeconds: number): boolean {
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.getTime())) throw new Error(`생년월일 형식 오류: ${birthDate}`);
  const at = new Date(atEpochSeconds * 1000);
  const eighteenth = new Date(
    Date.UTC(birth.getUTCFullYear() + 18, birth.getUTCMonth(), birth.getUTCDate()),
  );
  return at.getTime() >= eighteenth.getTime();
}
