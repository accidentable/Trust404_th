# 배포 — 관객 참여 시연

## 경로

| 경로 | 누가 | 무엇 |
|---|---|---|
| `/` | 누구나 | 랜딩: 프로세스 여섯 단계, 역할 카드 4장, [신분증 받기] 버튼이 `/merchant` 로 이어진다 |
| `/merchant` | 노트북 (사장님) | 사례 선택(5개) → 요청할 정보 조정 → [QR 띄우기] → 전체 화면 QR. 들어오는 제시가 목록으로 누적 |
| `/wallet?m=<merchantId>` | 알바생 폰 | 첫 진입 시 키쌍 생성 + 신분증 자동 발급(30개 이름 풀에서 배정, 더미 주민번호) → 3칸 승인 → 제시 |
| `/issuer` | 발표자 | 1 주민센터: 번호를 찍어 발급, 분실 신고(폐기). 결과의 holderId 가 `/holder?h=` 로 넘어간다 |
| `/holder?h=` | 발표자 | 2 나: 지갑이 보관 중인 것. `/verifier?h=` 로 넘어간다 |
| `/verifier?h=&s=` | 발표자 | 3 사장님: 제시 받기 → 검증 → 봉인 열어 보기(실패). 제시가 생기면 `s` 가 URL 에 붙는다 |
| `/tax?s=` | 발표자 | 4 국세청: 봉인 열기 → 지급명세서 |

**시연용 화면은 `/merchant` 와 `/wallet` 둘이다.** 주민센터와 국세청은 그 흐름에서 화면 없이 서버 안에 있다.

**역할 페이지 넷**(`/issuer` `/holder` `/verifier` `/tax`)은 각 단계의 내용을 눈으로 확인하는 용도다.
서로 다른 주체이고, 단계 간 전달은 URL(`h`=holderId, `s`=sessionId)로만 한다. 각 페이지는 혼자서도
열리고(앞 단계 결과가 없으면 그리로 안내), 응답은 요약으로 보이며 원본은 `JSON 보기` 아래에 접혀 있다.

**오프라인 백업**: 인터넷이 없어도 노트북에서 `npm run dev` 로 서버를 띄우면 두 화면 다 돈다.
사장님 화면의 "이 노트북에서 알바생 화면 열기 ↗" 링크가 QR 스캔을 대신한다.

QR 은 `https://<배포주소>/wallet?m=<merchantId>` 를 가리킨다. `m` 은 사장님 화면이
처음 열릴 때 서버에 등록되는 id 로, 브라우저 `localStorage` 에 남아 새로고침해도 유지된다.

## 역할별 API (내용 확인용)

네 단계의 내용을 JSON 으로 그대로 본다. 발급·제시·검증·봉인 코드는 폰 흐름과 같은 것을 쓴다.
홀더만 다르다: 여기서는 서버가 지갑을 대신 들고(내용 확인용), 폰 흐름에서는 키가 폰에만 있다.

| 단계 | 역할 | 엔드포인트 | 보여주는 것 |
|---|---|---|---|
| 1 | 주민센터 | `POST /api/issuer/issue` `{subject?: {name, birthDate, rrn}}` | 번호를 입력(없으면 더미)하면 발급. 조각·salt·다이제스트, 봉인 헤더, 평문 번호가 VC 에 없음 |
| 2 | 나 | `GET /api/holder/:holderId` | 지갑이 보관 중인 자격증명 전체 |
| 3 | 나 → 사장님 | `POST /api/holder/:holderId/present` `{merchantId?, deny?}` | 보낸 것 / 잠긴 것 / 안 보낸 것, KB-JWT 내용. `merchantId` 를 주면 사장님 화면 목록에도 뜬다 |
| 3 | 사장님 | `GET /api/verifier/:sessionId` | 검사 11개, 4줄 요약, 사장님 눈에 보이는 것(해시만 남은 항목 포함) |
| 3 | 사장님 | `POST /api/verifier/:sessionId/open` | 봉인 열기 시도. 실패해야 정상 |
| 4 | 국세청 | `POST /api/tax/unseal` `{sessionId}` | 봉인 해제 → 주민번호, 지급명세서 |

터미널에서 순서대로 돌려 보기:

```bash
npm run demo:api                                                   # 더미 이름·번호로
NAME=홍길동 BIRTH=2001-03-14 RRN=010314-3000000 npm run demo:api    # 번호를 직접 찍어서
MERCHANT=<merchantId> npm run demo:api                             # 사장님 화면(/merchant)에도 뜨게
npm run verify:live                                                # 폰 흐름 그대로 재현 + 검사 11개
```

서버 콘솔에는 API 호출마다 `[api] METHOD /path → status (ms)` 한 줄이 찍힌다.

## 온체인 폐기 (Phase 6)

`contracts/src/IssuerRegistry.sol` (CLAUDE.md §9 그대로). 체인에는 **폐기 인덱스와 여부만** 올라간다.
환경변수가 있으면 체인, 없으면 메모리 스텁. 화면과 API 는 어느 쪽이든 같다(스텁이면 화면에 "스텁"이라고 뜬다).

| 변수 | 설명 |
|---|---|
| `REGISTRY_ADDRESS` | 배포된 IssuerRegistry 주소 |
| `RPC_URL` | 체인 RPC. **사장님 브라우저가 이 주소를 직접 읽는다**(발급기관 서버를 거치지 않기 위해, §9). CORS 되는 공개 RPC 여야 한다 |
| `CHAIN_ID` | `11155111` Sepolia · `80002` Polygon Amoy · `84532` Base Sepolia · `421614` Arbitrum Sepolia · `11155420` Optimism Sepolia · `31337` anvil |
| `ISSUER_CHAIN_KEY` | 컨트랙트를 배포한 키. `revoke` 쓰기(분실 신고)에만 쓴다. 서버에만 둔다 |

로컬 (anvil):

```bash
anvil
cd contracts && forge test                                   # 6 tests
cd contracts && forge script script/Deploy.s.sol --rpc-url anvil --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil 0번 계정
REGISTRY_ADDRESS=0x... RPC_URL=http://127.0.0.1:8545 CHAIN_ID=31337 \
  ISSUER_CHAIN_KEY=0xac09...ff80 npm run dev
```

공개 테스트넷 (Sepolia 등):

```bash
# 1) 배포 전용 키 생성. 기존 지갑을 쓰지 말 것
cast wallet new                      # Address 와 Private key 가 나온다

# 2) 그 Address 로 테스트 토큰 받기 (faucet 목록은 아래)

# 3) RPC 준비 후 배포
export RPC_URL=https://...           # 브라우저가 직접 읽으므로 CORS 되는 곳
export ISSUER_CHAIN_KEY=0x...        # 1)의 Private key
cd contracts && forge script script/Deploy.s.sol --rpc-url testnet --broadcast --private-key $ISSUER_CHAIN_KEY
```

출력된 주소를 README §7 표와 배포 환경변수(`REGISTRY_ADDRESS`)에 넣는다.

### faucet: 메인넷 잔고를 요구하지 않는 곳

Alchemy·QuickNode faucet 은 봇 방지로 "메인넷에 0.001 ETH 이상" 을 요구한다. 아래는 그 조건이 없다.

| 테스트넷 | faucet | 조건 |
|---|---|---|
| Sepolia | https://sepolia-faucet.pk910.de | 브라우저에서 잠깐 채굴. 계정 불필요 |
| Sepolia | https://cloud.google.com/application/web3/faucet/ethereum/sepolia | 구글 계정 |
| Polygon Amoy | https://faucet.polygon.technology | 지갑 주소만 |
| Base Sepolia | https://portal.cdp.coinbase.com/products/faucet | Coinbase 개발자 계정 |

어느 체인을 쓰든 컨트랙트와 앱 코드는 그대로다. `CHAIN_ID` 와 `RPC_URL` 만 맞추면 되고,
화면에는 그 체인 이름과 익스플로러 링크가 자동으로 뜬다.

Sepolia 는 `revoke` 가 블록에 들어가기까지 십수 초 걸린다. 분실 신고 버튼이 그동안 "기록 중…" 으로 있다가 tx 해시와 익스플로러 링크를 보여준다.
한계: RPC 제공자는 어느 인덱스를 조회했는지 볼 수 있다(§15-7). 컨트랙트 소유자 키가 털리면 폐기가 조작될 수 있다.

## 왜 HTTPS 인가

폰 카메라 때문이 아니다 (카메라 앱은 어떤 URL 이든 연다). **WebCrypto** 때문이다.
`crypto.subtle` 은 보안 컨텍스트(HTTPS 또는 localhost)에서만 존재하고, 지갑의
KB-JWT 서명·검증이 그걸 쓴다. LAN IP(`http://192.168.x.x`)로 폰에서 열면 서명이 안 된다.

## 왜 단일 인스턴스인가

세션 서버(§13)는 메모리 `Map` 이다. Vercel 같은 서버리스는 요청마다 인스턴스가 갈릴 수
있어 관객 A 의 제시가 사장님 화면이 폴링하는 인스턴스에 없을 수 있다.
서버리스로 가려면 `server/store.ts` 의 `SessionStore` 뒤에 KV(Upstash 등)를 끼운다.
라우트는 바뀌지 않는다. 시연에는 단일 인스턴스가 덜 위험하다.

## 로컬에서 prod 모드 재현

배포 전에 프로덕션 경로(dist 서빙, 환경변수 검사)를 그대로 확인할 수 있다.

```bash
cp .env.example .env          # 시드 두 개를 생성해 채운다 (아래 명령)
npm run build
npm run start:local           # .env 를 읽어 --prod 로 실행
BASE=http://localhost:3000 npm run verify:live
```

`.env` 는 gitignore 된다. 배포 플랫폼에서는 대시보드가 환경변수를 주입하므로 `npm start` 를 쓴다.

## 환경변수

서버가 드는 두 키. 재시작해도 발급기관 DID 가 같아야 폰에 저장된 신분증이 계속 유효하다.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # ISSUER_SEED
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"   # TAX_SEED
```

| 변수 | 필수 | 설명 |
|---|---|---|
| `ISSUER_SEED` | prod 에서 필수 | 주민센터 Ed25519 seed, base64url 32바이트 |
| `TAX_SEED` | prod 에서 필수 | 국세청 X25519 seed, base64url 32바이트 |
| `PORT` | 선택 | 기본 3000 |

`--prod` 로 실행할 때 시드가 없으면 서버가 시작을 거부한다. dev 는 고정 개발용 시드를 쓴다.

## 로컬

```bash
npm run dev          # http://localhost:3000  — API + 프론트 한 포트 (Vite 미들웨어)
npm run build        # dist/
npm start            # prod 모드 — ISSUER_SEED, TAX_SEED 필요
```

## ncloud (네이버 클라우드) 서버에 올리기

VM 한 대에 앱 + Caddy(HTTPS 자동)를 올린다. 계속 떠 있는 서버라 세션이 메모리에 있어도 문제없다.

### 1. 서버 만들기

Server > Server 생성. Ubuntu 22.04, 최소 사양(2vCPU/4GB)이면 충분하다.
**공인 IP 를 붙이고**, ACG(방화벽)에서 인바운드를 연다.

| 프로토콜 | 포트 | 접근 소스 | 용도 |
|---|---|---|---|
| TCP | 22 | 내 IP | SSH |
| TCP | 80 | 0.0.0.0/0 | Let's Encrypt 인증서 발급 |
| TCP | 443 | 0.0.0.0/0 | HTTPS |

3000 번은 열지 않는다. Caddy 만 외부에 노출된다.

### 2. 서버에 접속해 준비

```bash
ssh root@<공인IP>

apt update && apt install -y docker.io docker-compose-plugin git
systemctl enable --now docker

git clone https://github.com/accidentable/Trust404_th.git
cd Trust404_th
```

### 3. 환경변수

```bash
cp .env.example .env
nano .env
```

`ISSUER_SEED` 와 `TAX_SEED` 는 아래로 만들어 채운다. 체인 관련은 컨트랙트 배포 후 채운다
(비워 두면 폐기만 스텁으로 동작하고 나머지는 전부 돈다).

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 4. 기존 서버와 같이 쓰는 경우

이미 다른 프로젝트가 도는 서버에 올려도 된다. 이 앱은 유휴 시 메모리 200MB 안팎이고 세션도
30분이면 사라진다. 충돌할 수 있는 건 **80/443 포트** 하나뿐이다. 먼저 확인한다.

```bash
sudo ss -tlnp '( sport = :80 or sport = :443 )'
```

**아무것도 안 나오면** → 아래 5번(Caddy 포함)으로 간다.

**nginx 나 Caddy 가 이미 잡고 있으면** → 앱만 띄우고 기존 프록시에 연결한다.

```bash
APP_PORT=3100 docker compose up -d --build     # 127.0.0.1:3100 에만 열린다
```

기존 nginx 라면 사이트 설정에 아래를 추가하고 `nginx -t && systemctl reload nginx`:

```nginx
server {
    server_name trust404.내도메인.com;       # 또는 별도 서브도메인
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

인증서는 `certbot --nginx -d trust404.내도메인.com` 으로 받는다.
기존 Caddy 라면 Caddyfile 에 블록 하나만 추가하면 인증서까지 자동이다:

```
trust404.내도메인.com {
    reverse_proxy 127.0.0.1:3100
}
```

> 서버를 새로 만들지 말지: 가벼운 프로젝트끼리는 같이 써도 된다. 다만 **두 프로젝트를 같은 날
> 시연한다면** 서버 하나가 죽을 때 둘 다 죽는다는 점은 감안한다.

### 5. HTTPS 주소 정하고 띄우기 (서버를 혼자 쓰는 경우)

**폰이 붙으려면 HTTPS 가 필수다**(WebCrypto 가 보안 컨텍스트에서만 동작). 도메인이 있으면 그걸 쓰고,
없으면 `nip.io` 를 쓴다 — IP 의 점을 하이픈으로 바꾼 주소가 그대로 도메인이 되고 인증서도 발급된다.

`.env` 에 두 줄을 추가한다. **`export` 로만 두면 안 된다** — 셸을 닫으면 값이 사라지고,
다음에 `docker compose up` 할 때 Caddy 가 빈 설정으로 재시작 루프에 빠진다.

```bash
# 공인 IP 가 123.45.67.89 라면
cat >> .env <<'ENV'
SITE_ADDRESS=123-45-67-89.nip.io
ACME_EMAIL=본인메일@example.com
ENV

docker compose --profile caddy up -d --build
docker compose logs -f caddy     # 인증서 발급 로그 확인 (1분 내)
```

Compose 가 `.env` 를 변수 치환에 자동으로 읽으므로 이걸로 영구 고정된다.

> Caddy 가 `Restarting` 을 반복하고 로그에 `server block without any key` 가 보이면
> `SITE_ADDRESS` 가 비어 있는 것이다. 위처럼 `.env` 에 넣고 `docker compose up -d` 하면 된다.

`https://123-45-67-89.nip.io` 로 열린다. 이 주소가 QR 에 들어간다.

### 6. 확인

```bash
BASE=https://123-45-67-89.nip.io npm run verify:live   # 로컬 노트북에서 실행
```

브라우저로 `/merchant` 를 열고 [QR 띄우기] → 폰으로 스캔 → 제시가 목록에 뜨는지 본다.

### 갱신

```bash
git pull
docker compose --profile caddy up -d --build   # 또는 APP_PORT=3100 docker compose up -d --build
```

## Docker (Fly.io / Railway / Render 공통)

```bash
docker build -t trust404 .
docker run -p 3000:3000 -e ISSUER_SEED=... -e TAX_SEED=... trust404
```

세 곳 모두 Dockerfile 을 그대로 읽고 HTTPS 를 붙여 준다. 환경변수 두 개만 대시보드에 넣는다.
인스턴스 수는 **1** 로 고정한다 (Fly: `fly scale count 1`).

## 시연 당일 체크

1. 배포 주소를 노트북에서 열고 [QR 띄우기] 가 활성화되는지 확인 (서버 등록 완료 표시)
2. 내 폰으로 QR 을 찍어 한 번 제시 → 사장님 화면에 1건 뜨는지 확인
3. 네트워크가 불안하면 노트북에서 `npm run dev` → 사장님 화면의 "이 노트북에서 알바생 화면 열기 ↗" 로 두 번째 탭에서 제시

## 한계 (README 에도 적을 것)

- 세션 서버는 시연 편의용이다. 실제로는 QR·딥링크로 지갑과 검증자가 직접 통신한다 (§15-6).
- 서버가 nonce 를 대신 발급하고 VP 를 중계하므로, 서버를 믿지 못하면 이 경로의 재사용 방지도 믿을 수 없다.
  서버는 VP 를 열어 보지 않고 검증은 사장님 브라우저에서 하지만, 중계자라는 사실 자체는 남는다.
- 세션 TTL 30분. 사장님 화면 목록도 그 뒤엔 사라진다.
