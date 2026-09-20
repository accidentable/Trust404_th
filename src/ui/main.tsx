import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { LandingPage } from './pages/LandingPage';
import { MerchantPage } from './pages/MerchantPage';
import { WalletPage } from './pages/WalletPage';
import { IssuerPage } from './pages/IssuerPage';
import { HolderPage } from './pages/HolderPage';
import { VerifierPage } from './pages/VerifierPage';
import { TaxPage } from './pages/TaxPage';
import { PayApp } from './pages/PayApp';
import './index.css';

/**
 * 라우터 없이 pathname 으로 가른다.
 *
 *   /            랜딩
 *   /merchant    사장님 실제 화면: 사례·항목 선택 → QR → 들어오는 제시 누적
 *   /wallet      알바생 폰 지갑: QR 로 열림 → 자동 발급 → 제시
 *
 *   역할별 API 페이지 (각자 다른 주체. 단계 간 전달은 URL 로)
 *   /issuer                 1 주민센터: 번호를 찍어 발급
 *   /holder?h=<holderId>    2 나: 지갑이 보관 중인 것
 *   /verifier?h=&s=         3 사장님: 제시 받기 → 검증 → 봉인 열어 보기(실패)
 *   /tax?s=<sessionId>      4 국세청: 봉인 열기 → 지급명세서
 */
const ROUTES: Record<string, ComponentType> = {
  '/app': PayApp,
  '/merchant': PayApp,
  '/wallet': PayApp,
  '/legacy/merchant': MerchantPage,
  '/legacy/wallet': WalletPage,
  '/issuer': IssuerPage,
  '/holder': HolderPage,
  '/verifier': VerifierPage,
  '/tax': TaxPage,
};

const path = window.location.pathname.replace(/\/+$/, '') || '/';
const Page = path === '/wallet' && new URLSearchParams(window.location.search).has('m')
  ? WalletPage
  : ROUTES[path] ?? LandingPage;

const container = document.getElementById('root');
if (!container) throw new Error('#root 를 찾을 수 없습니다');

createRoot(container).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
