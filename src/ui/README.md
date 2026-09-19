# UI

화면 두 개, 각자 별도 페이지. 라우터 없이 `main.tsx` 가 pathname 으로 가른다.

| 경로 | 파일 | 역할 |
|---|---|---|
| `/` | `pages/MerchantPage.tsx` | 사장님: 요청 항목 선택 → QR → 들어오는 제시 누적 목록. **검증은 여기서** 한다 |
| `/wallet?m=` | `pages/WalletPage.tsx` | 알바생: 자동 발급 → `screens/WalletApprovalScreen.tsx`(3칸) → 제시 |

- `screens/WalletApprovalScreen.tsx`: 보여줌 / 잠김 / 안 보냄. 항목은 요청의 `requested` 에서 나온다.
- `verification.ts`: 내부 검사 11개를 §10 의 4줄로 묶는다.
- `components/primitives.tsx`: 버튼·행·체크 줄. 화이트 톤, 화면당 필수 정보만.

주민센터·국세청은 화면이 없다: 키는 `server/authorities.ts` 에 있다.
