import { compactVerify, importJWK } from 'jose';
import { createVerifierSdJwt } from '../shared/sdjwt';
import type { JWK } from 'jose';
import {
  createVerifier,
  createVerifierForDid,
  ed25519FromPublicJwk,
  generateX25519KeyPair,
  privateJwkFromX25519,
  publicJwkFromEd25519,
  SIGNING_ALGORITHM,
  type X25519KeyPair,
} from '../shared/keys';
import { unseal, type JweCompact } from '../shared/sealing';
import type { ChainCall, RevocationRegistry } from '../shared/revocation';
import { ed25519PublicKeyFromDidKey, shortenDid } from '../shared/did';
import { SD_JWT_TYP, nowInSeconds } from '../shared/schema';
import type {
  PresentationRequest,
  RequestSatisfaction,
  SdJwtCompact,
  VerificationCheck,
  VerificationReport,
} from '../shared/types';
import { auditDisclosures, decodeJwtHeader, decodeJwtPayload, splitPresentation } from './disclosureAudit';
import { extractConfirmationJwk, verifyKeyBinding } from './keyBinding';

/** 봉인 열기 시도 한 건의 결과. 실패도 정상 결과다. */
export interface SealOpenAttempt {
  key: string;
  ok: boolean;
  plaintext?: string;
  error?: string;
}

export interface VerifyPresentationOptions {
  /** 이 검증자가 신뢰하는 발급기관 DID 목록. */
  trustedIssuers: readonly string[];
  expectedVct: string;
  /** 검증 시각(초). 만료 시연에서 미래로 밀어 쓴다. */
  now?: number;
  /**
   * 허용 시계 오차(초). 발급자와 검증자의 시계는 몇 초씩 어긋난다.
   * 이 여유가 없으면 방금 발급된 자격증명이 "아직 유효하지 않음"으로 거부된다.
   * 기본 120초. 만료 판정도 같은 폭만큼 너그러워진다.
   */
  skewSeconds?: number;
  /** 이 VP 를 받아낸 제시 요청. 넘기면 요청 충족 여부를 같이 보고한다. */
  request?: PresentationRequest;
  /**
   * Holder Binding 검사 여부. 기본값은 `request` 를 넘겼으면 true.
   * Phase 2 까지의 KB-JWT 없는 흐름을 재현할 때만 끈다.
   */
  requireKeyBinding?: boolean;
  /**
   * 폐기 레지스트리. 넘기면 `statusIndex` 로 조회해 폐기 여부를 확인한다.
   * 발급기관이 아니라 레지스트리에 묻기 때문에 발급기관은 사용 이력을 모른다. (§9)
   */
  revocationRegistry?: RevocationRegistry;
}

/**
 * 사장님 (Verifier)
 *
 * 검증은 사장님이 직접 한다. 발급기관이나 국세청에 물어보지 않는다. (§6)
 * did:key 라서 발급기관 서버에 접속할 일 자체가 없고,
 * 따라서 "이 사람이 지금 어디서 신분증을 쓰는지"가 새지 않는다.
 */
/**
 * 기본 허용 시계 오차. 배포 서버가 발급하고 폰·노트북이 검증하므로,
 * 여유가 없으면 방금 발급된 자격증명이 "아직 유효하지 않음"으로 거부된다.
 */
const DEFAULT_SKEW_SECONDS = 120;

export class EmployerVerifier {
  readonly name = '사장님';

  /**
   * 사장님도 자기 키쌍은 갖고 있다. 그래도 봉인은 열리지 않는다 —
   * 봉인은 국세청 공개키로 만들어졌기 때문이다. (§8-2)
   */
  private readonly ownKeyPair: X25519KeyPair = generateX25519KeyPair();

  /**
   * 봉인을 열어 본다. (§10 장면 B 의 [열기] 버튼)
   *
   * 성공할 수 없는 경로다. 갖고 있는 키를 전부 시도해도 실패한다는 것이
   * 이 프로젝트가 보여주려는 것이다.
   */
  async tryOpenSealed(sealed: JweCompact, extraKeys: JWK[] = []): Promise<SealOpenAttempt[]> {
    const candidates: { label: string; jwk: JWK }[] = [
      { label: '사장님 자신의 개인키', jwk: privateJwkFromX25519(this.ownKeyPair) },
      ...extraKeys.map((jwk, index) => ({
        label: `추가로 확보한 키 #${index + 1}`,
        jwk,
      })),
    ];

    const attempts: SealOpenAttempt[] = [];
    for (const candidate of candidates) {
      const result = await unseal(sealed, candidate.jwk);
      attempts.push({
        key: candidate.label,
        ok: result.ok,
        ...(result.plaintext !== undefined ? { plaintext: result.plaintext } : {}),
        ...(result.error !== undefined ? { error: result.error } : {}),
      });
    }
    return attempts;
  }

  async verify(
    presentation: SdJwtCompact,
    options: VerifyPresentationOptions,
  ): Promise<VerificationReport> {
    const now = options.now ?? nowInSeconds();
    const skew = options.skewSeconds ?? DEFAULT_SKEW_SECONDS;
    const checks: VerificationCheck[] = [];
    const push = (check: VerificationCheck) => checks.push(check);

    const { jwt } = splitPresentation(presentation);
    const header = decodeJwtHeader(jwt);
    const payload = decodeJwtPayload(jwt);
    const issuerDid = typeof payload.iss === 'string' ? payload.iss : '';

    // 1) 신뢰하는 발급기관인가 — 서명이 유효해도 아무나 발급한 건 안 받는다.
    const trusted = options.trustedIssuers.includes(issuerDid);
    push({
      id: 'issuer-trusted',
      label: '발급기관 확인',
      ok: trusted,
      detail: trusted
        ? `신뢰 목록에 있는 발급기관 (${shortenDid(issuerDid)})`
        : `신뢰하지 않는 발급기관: ${issuerDid || '(iss 없음)'}`,
    });

    // 2) 발급기관 서명 — did:key 에서 공개키를 꺼내 EdDSA 로 직접 검증한다.
    let signatureOk = false;
    let signatureDetail = '';
    try {
      const publicKey = await importJWK(
        publicJwkFromEd25519(ed25519PublicKeyFromDidKey(issuerDid)),
        SIGNING_ALGORITHM,
      );
      await compactVerify(jwt, publicKey, { algorithms: [SIGNING_ALGORITHM] });
      signatureOk = true;
      signatureDetail = `${SIGNING_ALGORITHM} 서명 유효 (typ=${String(header.typ)})`;
    } catch (error) {
      signatureDetail = `서명 불일치 — ${(error as Error).message}`;
    }
    push({ id: 'issuer-signature', label: '주민센터 서명 확인', ok: signatureOk, detail: signatureDetail });

    // 3) 유효기간. 시계 오차를 감안한다 (발급 서버와 검증 기기의 시계는 어긋난다).
    const exp = typeof payload.exp === 'number' ? payload.exp : undefined;
    const iat = typeof payload.iat === 'number' ? payload.iat : undefined;
    const nbf = typeof payload.nbf === 'number' ? payload.nbf : undefined;
    const notExpired = exp !== undefined && exp + skew > now;
    const alreadyValid = (nbf ?? iat ?? 0) - skew <= now;
    const validityOk = notExpired && alreadyValid;
    push({
      id: 'validity',
      label: '유효기간 정상',
      ok: validityOk,
      detail:
        exp === undefined
          ? 'exp 클레임이 없습니다'
          : !alreadyValid
            ? `아직 유효하지 않습니다 (iat=${iat ?? nbf ?? '?'}, 지금=${now}, 허용 오차 ${skew}초)`
            : notExpired
              ? `만료까지 ${exp - now}초 남음 (iat=${iat ?? '?'})`
              : `${now - exp}초 전에 만료됨`,
    });

    // 4) 타입 확인 — 계좌 VC 를 신분 VC 자리에 끼워 넣지 못하게 한다.
    const vctOk = payload.vct === options.expectedVct && header.typ === SD_JWT_TYP;
    push({
      id: 'credential-type',
      label: 'Credential 타입 확인',
      ok: vctOk,
      detail: vctOk ? `vct=${options.expectedVct}` : `기대: ${options.expectedVct} / 받음: ${String(payload.vct)}`,
    });

    // 5) 조각 해시 대조 — 보낸 값이 발급 당시 서명된 값과 같은지 직접 다시 계산한다.
    let audit;
    let digestsOk = false;
    let digestDetail = '';
    try {
      audit = auditDisclosures(presentation);
      digestsOk = true;
      digestDetail = `조각 ${audit.disclosed.length}개 해시 일치 · 비공개 ${audit.withheldDigests.length}개는 해시만 남음`;
    } catch (error) {
      audit = { disclosed: [], withheldDigests: [], sealed: {}, alwaysPresent: {} };
      digestDetail = (error as Error).message;
    }
    push({ id: 'disclosure-digests', label: '조각 해시 대조', ok: digestsOk, detail: digestDetail });

    // 6) Holder Binding — 이 VP 가 **나에게** **이 지갑이** 제시한 것인가. (§8-3)
    const requireKeyBinding = options.requireKeyBinding ?? options.request !== undefined;
    if (requireKeyBinding) {
      if (!options.request) {
        throw new Error('Holder Binding 을 검사하려면 제시 요청(nonce, verifier)이 필요합니다');
      }
      const kb = await verifyKeyBinding({
        presentation,
        confirmationJwk: extractConfirmationJwk(presentation),
        // 받은 VP 가 아니라 **내가 보낸 요청**에서 꺼낸다.
        expectedNonce: options.request.nonce,
        expectedAudience: options.request.verifier,
        now,
      });

      push({
        id: 'kb-signature',
        label: '본인 제시 확인',
        ok: kb.signatureOk,
        detail: kb.detail.signature,
      });
      push({ id: 'kb-nonce', label: 'nonce 확인', ok: kb.nonceOk, detail: kb.detail.nonce });
      push({ id: 'kb-audience', label: '수신자 확인', ok: kb.audienceOk, detail: kb.detail.audience });
      push({ id: 'kb-sd-hash', label: '제시 내용 고정', ok: kb.sdHashOk, detail: kb.detail.sdHash });
    }

    // 7) 폐기 여부 — 발급기관이 아니라 레지스트리에 묻는다. (§9)
    let chainCall: ChainCall | undefined;
    if (options.revocationRegistry) {
      const statusIndex = Number(payload.statusIndex);
      if (!Number.isFinite(statusIndex)) {
        push({
          id: 'revocation',
          label: '폐기 여부 확인',
          ok: false,
          detail: 'statusIndex 가 없어 폐기 여부를 확인할 수 없습니다',
        });
      } else {
        const { revoked, call } = await options.revocationRegistry.isRevoked(statusIndex);
        chainCall = call;
        push({
          id: 'revocation',
          label: '폐기 여부 확인',
          ok: !revoked,
          detail: revoked
            ? `폐기된 credential 입니다 — isRevoked(${statusIndex}) → true`
            : `유효 — isRevoked(${statusIndex}) → false`,
        });
      }
    }

    // 8) 레퍼런스 구현 교차 확인 — 위 검사들과 @sd-jwt/sd-jwt-vc 의 판정이 일치하는지 본다.
    let libraryOk = false;
    let libraryDetail = '';
    let verifiedPayload: Record<string, unknown> | undefined;
    try {
      const sdjwt = createVerifierSdJwt(
        createVerifierForDid(issuerDid),
        // KB-JWT 는 본체 VC 의 cnf 공개키로만 검증한다.
        (data, signature, kbPayload) => {
          const cnf = (kbPayload as { cnf?: { jwk?: JWK } }).cnf;
          if (!cnf?.jwk) return false;
          return createVerifier(ed25519FromPublicJwk(cnf.jwk))(data, signature);
        },
      );
      const result = await sdjwt.verify(presentation, {
        currentDate: now,
        skewSeconds: skew,
        ...(requireKeyBinding && options.request
          ? {
              keyBindingNonce: options.request.nonce,
              expectedKeyBindingAudience: options.request.verifier,
            }
          : {}),
      });
      verifiedPayload = result.payload as unknown as Record<string, unknown>;
      libraryOk = true;
      libraryDetail = '@sd-jwt/sd-jwt-vc 검증 통과';
    } catch (error) {
      libraryDetail = `@sd-jwt/sd-jwt-vc 거부 — ${(error as Error).message}`;
    }
    push({
      id: 'library-crosscheck',
      label: '레퍼런스 구현 교차 확인',
      ok: libraryOk,
      detail: libraryDetail,
    });

    // 요청 충족 여부 — 암호 검사와 섞지 않는다. 홀더가 항목을 거부해도 VC 는 유효하다.
    let request: RequestSatisfaction | undefined;
    if (options.request) {
      // 받은 것 = 조각으로 온 것 + 평문으로 온 것 + 잠긴 채 온 것. 봉인은 열 수 없어도 "받은" 것이다.
      const received = new Set([
        ...audit.disclosed.map((claim) => claim.key),
        ...Object.keys(audit.alwaysPresent),
        ...Object.keys(audit.sealed),
      ]);
      const missing = options.request.requested.filter((key) => !received.has(key));
      request = {
        satisfied: missing.length === 0,
        received: options.request.requested.filter((key) => received.has(key)),
        missing,
      };
    }

    return {
      ok: checks.every((check) => check.ok),
      checks,
      audit,
      ...(verifiedPayload ? { payload: verifiedPayload } : {}),
      ...(request ? { request } : {}),
      ...(chainCall ? { chainCall } : {}),
    };
  }
}
