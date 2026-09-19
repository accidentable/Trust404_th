import { describeClaim } from '../shared/schema';
import type {
  ApprovalItem,
  ApprovalPlan,
  PresentationRequest,
  StoredCredential,
} from '../shared/types';

export interface ApprovalDecisions {
  /** 홀더가 요청받았지만 주기 싫다고 뺀 항목. 지갑의 최종 결정권은 홀더에게 있다. */
  deny?: readonly string[];
}

/**
 * 승인 화면을 요청에서 **동적으로** 만든다. (§7 "하드코딩 금지")
 *
 * 사장님이 요청 항목을 바꾸면 이 결과가 바뀌고, 따라서 지갑 화면도 바뀐다.
 * 3칸(보여줌 / 잠긴 채 전달 / 보내지 않음)은 여기서 계산된 그대로 그려진다.
 */
export function buildApprovalPlan(
  credential: StoredCredential,
  request: PresentationRequest,
  decisions: ApprovalDecisions = {},
  now: Date = new Date(),
): ApprovalPlan {
  const denied = new Set(decisions.deny ?? []);
  const requested = new Set(request.requested);

  const shown: ApprovalItem[] = [];
  const withheld: ApprovalItem[] = [];
  const unavailable: ApprovalItem[] = [];
  const disclose: string[] = [];

  // 1) 봉인 필드 — 요청 여부와 **무관하게** 항상 따라간다.
  //    홀더가 뺄 수 없으므로, 요청받지 않았다고 화면에서 숨기면 거짓말이 된다.
  const sealed: ApprovalItem[] = credential.sealedClaims.map((key) => {
    const descriptor = describeClaim(key);
    return {
      key,
      label: descriptor.label,
      note: descriptor.note
        ? `${descriptor.note}${requested.has(key) ? '' : ' · 요청되지 않았지만 항상 동봉됨'}`
        : '상대는 열 수 없음',
    };
  });

  // 2) 골라낼 수 없는 평문 항목 — 역시 항상 따라간다.
  const alwaysSent: ApprovalItem[] = Object.entries(credential.plaintextClaims).map(
    ([key, value]) => ({ key, label: describeClaim(key).label, value }),
  );

  // 3) 요청받은 항목을 훑는다.
  for (const key of request.requested) {
    const descriptor = describeClaim(key);
    const item: ApprovalItem = { key, label: descriptor.label };
    if (descriptor.note) item.note = descriptor.note;

    if (descriptor.mode === 'sealed') {
      // 위에서 이미 sealed 칸에 넣었다. 지갑에 없을 때만 따로 알린다.
      if (!credential.sealedClaims.includes(key)) {
        unavailable.push({ ...item, note: '지갑에 없는 항목' });
      }
      continue;
    }

    if (descriptor.mode === 'always') continue; // 항상 전달 칸에서 이미 다룬다

    if (!(key in credential.selectiveClaims)) {
      unavailable.push({ ...item, note: `지갑에 없는 항목 (${descriptor.vct})` });
      continue;
    }

    if (denied.has(key)) {
      withheld.push({ ...item, note: '요청받았지만 홀더가 거부' });
      continue;
    }

    shown.push({ ...item, value: credential.selectiveClaims[key] });
    disclose.push(key);
  }

  // 4) 지갑이 갖고 있지만 요청받지 않은 항목 — 이쪽이 "보내지 않음"의 대부분이다.
  for (const key of Object.keys(credential.selectiveClaims)) {
    if (requested.has(key)) continue;
    const descriptor = describeClaim(key);
    withheld.push({ key, label: descriptor.label, note: '요청되지 않음' });
  }

  return {
    verifier: request.verifier,
    purpose: request.purpose,
    expiresAt: request.expiresAt,
    nonce: request.nonce,
    requestExpired: new Date(request.expiresAt).getTime() <= now.getTime(),
    shown,
    sealed,
    withheld,
    alwaysSent,
    unavailable,
    disclose,
  };
}
