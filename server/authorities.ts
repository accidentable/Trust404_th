import { base64url } from 'jose';
import { ResidentCenterIssuer } from '../src/issuer/residentCenter';
import { NationalTaxService } from '../src/tax/nationalTaxService';
import { ed25519KeyPairFromSeed, x25519KeyPairFromSeed } from '../src/shared/keys';
import { randomBytes } from '../src/shared/crypto';
import type { ResidentIdSubject } from '../src/shared/types';

/**
 * 서버가 드는 두 기관 — 주민센터(발급 서명키)와 국세청(봉인 수신키).
 *
 * 관객 폰마다 발급자 키를 새로 만들면 사장님이 신뢰할 발급기관이 없어진다.
 * 그래서 발급은 서버에서 하고, 키는 고정 시드에서 복원해 재시작해도 DID 가 같다.
 * 사장님 화면은 어떤 키도 갖지 않는다 — 검증만 한다. (§6)
 */
function seedFromEnv(name: string, devFallback: string): Uint8Array {
  const value = process.env[name];
  if (value) {
    const bytes = base64url.decode(value);
    if (bytes.length !== 32) throw new Error(`${name} 은 base64url 32바이트여야 합니다`);
    return bytes;
  }
  if (process.env.NODE_ENV === 'production' || process.argv.includes('--prod')) {
    throw new Error(`${name} 환경변수가 필요합니다 (base64url 32바이트)`);
  }
  // 개발용 고정 시드. 배포에서는 위에서 막힌다.
  return new TextEncoder().encode(devFallback.padEnd(32, '.')).subarray(0, 32);
}

export const residentCenter = new ResidentCenterIssuer(
  ed25519KeyPairFromSeed(seedFromEnv('ISSUER_SEED', 'trust404-dev-issuer')),
);

export const taxService = new NationalTaxService(
  x25519KeyPairFromSeed(seedFromEnv('TAX_SEED', 'trust404-dev-tax')),
);

/**
 * 알바생 이름 풀 — 30명까지 서로 다른 이름을 받는다. 실제 인물이 아니다.
 * 서버가 뜰 때 한 번 섞어서 순서대로 배정한다. 31명째부터는 뒤에 숫자가 붙는다.
 */
const NAME_POOL = [
  '김민준', '이서연', '박도윤', '최지우', '정하준', '강서현', '조은우', '윤지호',
  '장하은', '임시우', '한예린', '오준서', '서수아', '신유준', '권다은', '황지훈',
  '안채원', '송현우', '류지민', '홍승민', '전소율', '고태양', '문서준', '양하린',
  '배지안', '백건우', '허나연', '남시윤', '유주원', '노아린',
];

const shuffledNames = shuffle(NAME_POOL);
let audienceCounter = 0;

/**
 * 알바생 신분증 자동 배정. 실제 개인정보는 받지 않는다.
 * 이름은 위 풀에서, 주민등록번호는 형식만 맞춘 더미 난수, 생년월일은 전원 만 18세 이상.
 */
export function nextAudienceSubject(): ResidentIdSubject {
  const index = audienceCounter;
  audienceCounter += 1;
  const base = shuffledNames[index % shuffledNames.length] as string;
  const round = Math.floor(index / shuffledNames.length);
  const name = round === 0 ? base : `${base}${round + 1}`;
  const year = 1985 + randomInt(20); // 1985 ~ 2004
  const month = 1 + randomInt(12);
  const day = 1 + randomInt(28);
  const yy = String(year).slice(2);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const genderDigit = year < 2000 ? 1 + randomInt(2) : 3 + randomInt(2);
  const tail = String(randomInt(1_000_000)).padStart(6, '0');

  return {
    name,
    address: '(수집하지 않음)',
    birthDate: `${year}-${mm}-${dd}`,
    rrn: `${yy}${mm}${dd}-${genderDigit}${tail}`,
  };
}

/** Fisher–Yates. 서버 시작마다 순서가 달라진다. */
function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

function randomInt(max: number): number {
  const b = randomBytes(4);
  const value = ((b[0] as number) << 24) | ((b[1] as number) << 16) | ((b[2] as number) << 8) | (b[3] as number);
  return (value >>> 0) % max;
}
