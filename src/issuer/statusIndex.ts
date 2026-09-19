import { randomBytes } from '../shared/crypto';

/**
 * 폐기 확인용 인덱스 배정 (§8-4)
 *
 * **순차 배정 금지.** 1, 2, 3… 으로 주면 인덱스만 보고 발급 순서와 대략적인
 * 발급 시점이 드러난다. 체인에 올라가는 유일한 숫자이므로 난수여야 한다.
 */
const STATUS_INDEX_SPACE = 1_000_000;

export function assignStatusIndex(): number {
  const bytes = randomBytes(4);
  const value =
    ((bytes[0] as number) << 24) |
    ((bytes[1] as number) << 16) |
    ((bytes[2] as number) << 8) |
    (bytes[3] as number);
  return (value >>> 0) % STATUS_INDEX_SPACE;
}
