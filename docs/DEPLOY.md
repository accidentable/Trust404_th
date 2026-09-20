# SabonX 배포 안내

## 로컬 실행

Node.js 22와 npm을 사용합니다. 환경변수 없이도 로컬 폐기 목록으로 실행할 수 있습니다.

```sh
npm ci
npm run dev
```

랜딩은 `/`, 근로자 앱은 `/app`, 사업주 앱은 `/app?role=merchant`입니다. 새 데모의 기본 근로자는 **윤태호**입니다. 가상 정보이며 기존 세션에서 변경한 이름은 유지됩니다.

## 서버 환경 설정

`.env.example`을 `.env`로 복사하고 기관 키와 필요한 체인 설정을 채웁니다. `.env`는 저장소나 배포 압축파일에 포함하지 않습니다.

- `ISSUER_SEED`, `TAX_SEED`: 프로덕션에서 필수인 기관 키 시드입니다. 각각 별도로 생성한 base64url 32바이트 값을 사용하고 재배포 시 유지합니다.
- `REGISTRY_ADDRESS`, `RPC_URL`, `CHAIN_ID`: 온체인 폐기 조회 설정입니다. Sepolia 체인 ID는 `11155111`입니다.
- `ISSUER_CHAIN_KEY`: 레지스트리의 폐기 쓰기 권한을 가진 계정의 개인키입니다. 기관 VC 서명 시드와 별개의 키입니다.
- `SITE_ADDRESS`, `ACME_EMAIL`: Caddy의 도메인과 인증서 관리 이메일입니다.

기관 시드 생성 명령은 `.env.example`에 있습니다. 환경변수를 적용해 개발 서버를 실행하려면 `npm run dev:local`을 사용합니다.

## Docker와 HTTPS

80/443 포트를 사용할 수 있는 서버에서:

```sh
docker compose --profile caddy up -d --build
```

기존 HTTPS 프록시가 있으면 앱만 실행하고 프록시를 `127.0.0.1:3000`에 연결합니다. 외부 포트는 `APP_PORT`로 변경할 수 있습니다.

```sh
docker compose up -d --build app
```

기존 배포의 앱 갱신:

```sh
docker compose build app
docker compose up -d --no-deps app
docker compose logs --tail=40 app
```

`/api/chain`의 `configured`, `isStub`, 컨트랙트 주소로 연결 상태를 확인합니다. 서버 세션은 메모리 기반이므로 재시작 후 새 데모를 시작합니다. 지갑 저장소와 온체인 폐기 기록은 별도로 남습니다. 앱은 단일 인스턴스로 실행합니다.

## 폐기 컨트랙트 배포

Foundry 설치 후 `contracts` 디렉터리에서 의존성을 설치하고 테스트합니다.

```sh
cd contracts
forge install foundry-rs/forge-std --no-git
forge test
```

배포할 네트워크의 `RPC_URL`과 배포 계정의 `ISSUER_CHAIN_KEY`를 환경변수로 설정한 뒤 실행합니다. 다음 예시는 Linux 서버 셸 기준입니다.

```sh
forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --private-key "$ISSUER_CHAIN_KEY"
```

배포된 주소를 앱의 `REGISTRY_ADDRESS`에 반영합니다. 폐기 트랜잭션은 기관 계정이 컨트랙트로 보내며, 제출 검증은 서버가 `revoked(statusIndex)`를 조회합니다. 조회 자체는 새 트랜잭션을 만들지 않습니다.

## 검증

```sh
npm run build
```

별도의 로컬 데모 서버를 실행한 상태에서:

```sh
npm run test:payroll
```

테스트는 급여 요청과 폐기 상태를 변경하므로 운영 중인 시연 세션 대신 로컬 서버에서 실행합니다. 구현 상세는 [APP-DEMO.md](APP-DEMO.md)를 참고하세요.
