import { randomBytes } from '../shared/crypto';

/**
 * 폐기 확인용 인덱스 배정 (§8-4)
 *
 * **순차 배정 금지.** 1, 2, 3… 으로 주면 인덱스만 보고 발급 순서와 대략적인
 * 발급 시점이 드러난다. 체인에 올라가는 유일한 숫자이므로 난수여야 한다.
 */
const assigned = new Set<number>();

export function assignStatusIndex(): number {
  // 48-bit safe integer; avoid collisions within this issuer process.
  // Production issuers must additionally enforce uniqueness in durable storage.
  let value: number;
  do { value = randomBytes(6).reduce((n, b) => n * 256 + b, 0); } while (assigned.has(value));
  assigned.add(value);
  return value;
}
