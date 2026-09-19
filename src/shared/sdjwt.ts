import { SDJwtVcInstance } from '@sd-jwt/sd-jwt-vc';
import type { KbVerifier, Signer, Verifier } from '@sd-jwt/core';
import { HASH_ALGORITHM, hasher, saltGenerator } from './crypto';
import { SIGNING_ALGORITHM } from './keys';

/**
 * 발급용 인스턴스 — 서명키를 쥔 쪽(주민센터·은행)만 만든다.
 */
export function createIssuerSdJwt(signer: Signer): SDJwtVcInstance {
  return new SDJwtVcInstance({
    signer,
    signAlg: SIGNING_ALGORITHM,
    hasher,
    hashAlg: HASH_ALGORITHM,
    saltGenerator,
  });
}

/**
 * 제시용 인스턴스 — 홀더는 발급자 서명키 없이도 조각을 골라낸다.
 * 본체 JWT 를 건드리지 않으므로 발급자 서명은 그대로 유효하다. (§7)
 *
 * `kbSigner` 는 홀더 **자신의** 개인키다. 이걸로 nonce 에 서명해야
 * 사장님이 받은 VP 를 다른 곳에 복사해도 통과하지 못한다. (§8-3)
 */
export function createHolderSdJwt(kbSigner?: Signer): SDJwtVcInstance {
  return new SDJwtVcInstance({
    hasher,
    hashAlg: HASH_ALGORITHM,
    saltGenerator,
    ...(kbSigner ? { kbSigner, kbSignAlg: SIGNING_ALGORITHM } : {}),
  });
}

/**
 * 검증용 인스턴스 — 발급자 공개키로 본체 서명을, `cnf` 공개키로 KB-JWT 를 확인한다.
 * `loadTypeMetadataFormat` 을 켜지 않으므로 검증 중 외부 네트워크 요청이 없다.
 */
export function createVerifierSdJwt(verifier: Verifier, kbVerifier?: KbVerifier): SDJwtVcInstance {
  return new SDJwtVcInstance({
    verifier,
    hasher,
    hashAlg: HASH_ALGORITHM,
    ...(kbVerifier ? { kbVerifier } : {}),
  });
}
