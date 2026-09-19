/**
 * base58btc (Bitcoin alphabet) — did:key 의 multibase 'z' 접두사에 쓰인다.
 *
 * §13 의 의존성 표에 base58 라이브러리가 없으므로 직접 구현한다.
 * 알고리즘은 base-x 와 동일한 고전적 방식(바이트열 ↔ 58진수 변환)이다.
 */
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP = new Map<string, number>([...ALPHABET].map((c, i) => [c, i]));

export function base58btcEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';

  // 선행 0 바이트는 58진수 변환에 기여하지 않으므로 따로 세어 '1' 로 복원한다.
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;

  const digits: number[] = [];
  for (const byte of bytes.subarray(leadingZeros)) {
    let carry = byte;
    for (let i = 0; i < digits.length; i += 1) {
      carry += (digits[i] as number) << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let out = '1'.repeat(leadingZeros);
  for (let i = digits.length - 1; i >= 0; i -= 1) out += ALPHABET[digits[i] as number];
  return out;
}

export function base58btcDecode(text: string): Uint8Array {
  if (text.length === 0) return new Uint8Array(0);

  let leadingOnes = 0;
  while (leadingOnes < text.length && text[leadingOnes] === '1') leadingOnes += 1;

  const bytes: number[] = []; // little-endian 누산기
  for (const ch of text.slice(leadingOnes)) {
    const value = ALPHABET_MAP.get(ch);
    if (value === undefined) throw new Error(`base58btc: 알파벳에 없는 문자 "${ch}"`);
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      carry += (bytes[i] as number) * 58;
      bytes[i] = carry & 0xff;
      carry >>>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>>= 8;
    }
  }

  bytes.reverse();
  return Uint8Array.from([...new Array<number>(leadingOnes).fill(0), ...bytes]);
}
