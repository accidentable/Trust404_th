# APIs

역할별 엔드포인트. 각 단계에서 **무엇이 오가고 무엇이 오가지 않는지**를 JSON 으로 그대로 확인할 수 있다.

브라우저에서 눌러 볼 수 있는 페이지도 있다: `/issuer` `/holder` `/verifier` `/tax`

---

## 1. 주민센터 (Issuer)

### `POST /api/issuer/issue`

자격증명을 발급한다. 주민등록번호는 이 시점에 국세청 공개키로 봉인되고, 이후 평문으로 존재하지 않는다.

**Request**

```json
{ "subject": { "name": "홍길동", "birthDate": "2001-03-14", "rrn": "010314-3000000" } }
```

`subject` 를 비우면 더미 값이 채워진다. 실제 개인정보를 넣지 않아도 전체 흐름이 돈다.

**Response** (요약)

```json
{
  "holderId": "288c846c52b4",
  "plaintextRrnInCredential": false,
  "credential": {
    "selective": {
      "name":      { "value": "홍길동", "salt": "9b8d21v6…", "digest": "vNP-qLPa…" },
      "isOver18":  { "value": true,     "salt": "6SEbvaYQ…", "digest": "PCC_aaex…" },
      "address":   { "…": "…" },
      "birthDate": { "…": "…" }
    },
    "sealed": {
      "rrn_sealed": { "algorithm": "ECDH-ES+A256KW", "encryption": "A256GCM", "audience": "국세청" }
    },
    "plaintext": { "statusIndex": 253392 }
  }
}
```

`plaintextRrnInCredential` 은 자격증명 전체를 문자열 검색한 결과다. 항상 `false` 여야 한다.

### `POST /api/issuer/revoke`

분실 신고. 폐기 레지스트리에 **인덱스 번호만** 기록한다. 발급기관 키로 서명한 트랜잭션이다.

```json
{ "statusIndex": 305634 }
```

```json
{
  "call": {
    "method": "revoke", "argument": 305634, "result": "block 11735285",
    "txHash": "0xaccbda41…",
    "explorerUrl": "https://sepolia.etherscan.io/tx/0xaccbda41…"
  }
}
```

---

## 2. 지갑 (Holder)

### `GET /api/holder/:holderId`

지갑이 보관 중인 자격증명을 본다.

```json
{
  "did": "did:key:z6MkronU34esXiENcrSzd9YPvQqpdmS3Uqzq81AuPcnRQEmD",
  "credentials": [ { "selective": { "…": "…" }, "sealed": { "…": "…" } } ]
}
```

> 이 엔드포인트의 지갑은 **서버가 대신 든다**(내용 확인용). 폰 흐름(`/wallet`)에서는 개인키가 폰의
> IndexedDB 에만 있고 서버로 오지 않는다. 발급·제시 코드는 양쪽이 같은 것을 쓴다.

### `POST /api/holder/:holderId/present`

제시를 만든다. 요청받은 항목 중 줄 것만 골라 조각을 붙이고, nonce 에 홀더 개인키로 서명한다.

```json
{ "merchantId": "선택", "deny": ["address"] }
```

```json
{
  "sessionId": "cb63b28d54b8cab99a1a5bbd",
  "sent": {
    "shown":    [ { "key": "name", "value": "홍길동" }, { "key": "isOver18", "value": true } ],
    "sealed":   [ { "key": "rrn_sealed" } ],
    "withheld": [ { "key": "address" }, { "key": "birthDate" } ]
  },
  "presentation": {
    "disclosures": 2,
    "keyBindingJwt": { "nonce": "9a93004b88972ff7", "aud": "행사운영팀", "sd_hash": "AJ4stk2D…" }
  }
}
```

`deny` 로 요청받은 항목도 뺄 수 있다. **최종 결정권은 지갑에 있다.**

---

## 3. 사장님 (Verifier)

### `GET /api/verifier/:sessionId`

검증한다. 내부 검사 11개를 돌리고 화면용 4줄 요약을 함께 돌려준다.

```json
{
  "ok": true,
  "summary": [
    { "label": "주민센터 서명 확인", "ok": true },
    { "label": "유효기간 정상",     "ok": true },
    { "label": "본인 제시 확인",    "ok": true },
    { "label": "폐기 여부 확인",    "ok": true }
  ],
  "sees": {
    "disclosed":       [ { "key": "name", "value": "홍길동" }, { "key": "isOver18", "value": true } ],
    "sealed":          { "rrn_sealed": { "algorithm": "ECDH-ES+A256KW" } },
    "withheldDigests": [ "EACu619x…", "gmnr7Q_f…" ]
  }
}
```

`withheldDigests` 가 핵심이다. 보내지 않은 항목은 **다이제스트만** 남아 사장님은 이름도 값도 알 수 없다.

내부 검사 11개: `issuer-trusted` `issuer-signature` `validity` `credential-type` `disclosure-digests`
`kb-signature` `kb-nonce` `kb-audience` `kb-sd-hash` `revocation` `library-crosscheck`

> 검증은 **서버가 아니라 사장님 브라우저**에서 한다. 이 엔드포인트는 같은 코드를 같은 옵션으로 돌린 것이다.

### `POST /api/verifier/:sessionId/open`

봉인을 열어 본다. **항상 실패한다.** 그게 이 엔드포인트의 목적이다.

```json
{
  "opened": false,
  "attempts": [
    { "key": "사장님 자신의 개인키", "ok": false, "error": "decryption operation failed" },
    { "key": "국세청 공개키",       "ok": false, "error": "must be of type \"private\"" }
  ]
}
```

공개키로는 봉인을 만들 수만 있다. 여는 건 국세청 개인키로만 된다.

---

## 4. 국세청

### `POST /api/tax/unseal`

사장님이 신고서에 그대로 첨부한 봉인을 국세청 개인키로 연다.

```json
{ "sessionId": "cb63b28d54b8cab99a1a5bbd" }
```

```json
{
  "rrn": "010314-3000000",
  "statement": {
    "서식": "일용근로소득 지급명세서",
    "성명": "홍길동",
    "주민등록번호": "010314-3000000",
    "지급액": 150000,
    "원천징수세액": 0
  }
}
```

세금은 0원이다. 그런데도 지급명세서 제출 의무는 있고, 거기엔 주민등록번호 13자리가 필요하다.
**사장님을 거치지 않고** 그 값이 여기 도착했다.

---

## 그 외

| 엔드포인트 | 설명 |
|---|---|
| `GET /api/issuer` | 발급기관 DID, 자격증명 형식 버전 |
| `GET /api/chain` | 폐기 레지스트리 설정. 브라우저가 이걸 받아 RPC 를 직접 읽는다 |
| `GET /api/revocation/:index` | 폐기 여부 조회 |
| `POST /api/merchant` | 사장님 요청 템플릿 등록 (QR 대상) |
| `POST /api/session` | 지갑이 제시 요청과 nonce 를 받아 간다 |
| `POST /api/session/:id/vp` | 지갑이 제시를 보낸다 |
| `GET /api/merchant/:id/sessions` | 사장님 화면이 들어온 제시를 폴링한다 |

## 터미널에서 한 번에 돌려 보기

```bash
npm run demo:api                                                  # 1 → 4 순서로 전부
NAME=홍길동 BIRTH=2001-03-14 RRN=010314-3000000 npm run demo:api   # 번호를 직접 넣어서
BASE=https://211-233-200-43.nip.io npm run verify:live            # 배포본 상대로 검사 11개
```
