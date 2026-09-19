import { base58btcDecode, base58btcEncode } from './base58';

/**
 * did:key — W3C did:key Method
 *
 * 식별자 자체가 공개키다. 레지스트리에 키를 물어볼 필요가 없으므로
 * "검증자가 발급기관 서버에 접속하는 순간 사용 이력이 샌다"는 문제를 피한다.
 * (§9 발급자-검증자 비연결성)
 *
 * 두 곡선을 쓴다.
 *  - Ed25519 (0xed01): 서명용 — 주민센터·은행·지갑
 *  - X25519  (0xec01): 키 합의용 — 국세청 봉인 수신 키 (§8-2)
 *    Ed25519 키로는 ECDH 를 할 수 없어서 봉인 수신자는 별도 곡선을 쓴다.
 */
export type DidKeyCurve = 'Ed25519' | 'X25519';

const MULTICODEC_PREFIX: Record<DidKeyCurve, Uint8Array> = {
  Ed25519: Uint8Array.from([0xed, 0x01]),
  X25519: Uint8Array.from([0xec, 0x01]),
};

const DID_KEY_PREFIX = 'did:key:';
const PUBLIC_KEY_LENGTH = 32;

export function didKeyFromPublicKey(publicKey: Uint8Array, curve: DidKeyCurve): string {
  if (publicKey.length !== PUBLIC_KEY_LENGTH) {
    throw new Error(`did:key: ${curve} 공개키는 32바이트여야 합니다 (받은 값: ${publicKey.length})`);
  }
  const prefix = MULTICODEC_PREFIX[curve];
  const multicodec = new Uint8Array(prefix.length + publicKey.length);
  multicodec.set(prefix, 0);
  multicodec.set(publicKey, prefix.length);
  return `${DID_KEY_PREFIX}z${base58btcEncode(multicodec)}`;
}

export function publicKeyFromDidKey(did: string): { publicKey: Uint8Array; curve: DidKeyCurve } {
  if (!did.startsWith(DID_KEY_PREFIX)) {
    throw new Error(`did:key 가 아닙니다: ${did}`);
  }
  const multibase = did.slice(DID_KEY_PREFIX.length);
  if (!multibase.startsWith('z')) {
    throw new Error(`did:key: base58btc('z') 인코딩만 지원합니다: ${did}`);
  }

  const decoded = base58btcDecode(multibase.slice(1));
  const curve = (Object.keys(MULTICODEC_PREFIX) as DidKeyCurve[]).find((candidate) => {
    const prefix = MULTICODEC_PREFIX[candidate];
    return decoded[0] === prefix[0] && decoded[1] === prefix[1];
  });
  if (!curve) {
    throw new Error(
      `did:key: 지원하지 않는 multicodec (0x${(decoded[0] ?? 0).toString(16)}${(decoded[1] ?? 0).toString(16)})`,
    );
  }

  const publicKey = decoded.subarray(MULTICODEC_PREFIX[curve].length);
  if (publicKey.length !== PUBLIC_KEY_LENGTH) {
    throw new Error(`did:key: 공개키 길이가 32바이트가 아닙니다 (${publicKey.length})`);
  }
  return { publicKey, curve };
}

export function didKeyFromEd25519PublicKey(publicKey: Uint8Array): string {
  return didKeyFromPublicKey(publicKey, 'Ed25519');
}

export function didKeyFromX25519PublicKey(publicKey: Uint8Array): string {
  return didKeyFromPublicKey(publicKey, 'X25519');
}

export function ed25519PublicKeyFromDidKey(did: string): Uint8Array {
  const { publicKey, curve } = publicKeyFromDidKey(did);
  if (curve !== 'Ed25519') throw new Error(`Ed25519 did:key 가 아닙니다 (${curve}): ${did}`);
  return publicKey;
}

export function x25519PublicKeyFromDidKey(did: string): Uint8Array {
  const { publicKey, curve } = publicKeyFromDidKey(did);
  if (curve !== 'X25519') throw new Error(`X25519 did:key 가 아닙니다 (${curve}): ${did}`);
  return publicKey;
}

/** 로그·화면에 DID 전체를 찍으면 길어서 읽히지 않는다. */
export function shortenDid(did: string, head = 16, tail = 6): string {
  if (did.length <= head + tail + 1) return did;
  return `${did.slice(0, head)}…${did.slice(-tail)}`;
}
