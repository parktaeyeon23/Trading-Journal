# ALPHA JOURNAL

단기 추세추종 트레이더 1명이 KR·US 현물 매매를 기록·복기하는 개인용 투자일지 PWA.
PRD와 단계별 프롬프트: "ALPHA JOURNAL — 장기 사용 투자일지 앱 PRD" 문서 (PRD 탭, Claude Code 프롬프트 탭).
디자인 기준: "ALPHA JOURNAL 디자인 시안" 캔버스 (캘린더·트레이드 상세·분석·모바일 계산기).

## 기술 스택

변경하려면 먼저 이유와 대안을 제시하고 승인받는다.

- 프론트: Vite + TypeScript + React, 상태관리 Zustand
- 로컬 저장: IndexedDB (idb)
- PWA: vite-plugin-pwa
- 테스트: Vitest (`npm test`)
- 배포: GitHub Pages (정적 빌드, 해시 라우팅 `#/calendar`)
- 백엔드: Google Apps Script 웹앱 + Google Sheets(데이터) + Google Drive(차트 이미지). GAS 코드는 `/gas`에서 clasp로 관리.

## 폴더 구조

```
/src
  /core      손익·R·사이징·등급 계산. 순수 함수만. React·IndexedDB import 금지
  /data      백엔드 어댑터 인터페이스, GAS 어댑터, IndexedDB 캐시, 동기화
  /features  calendar, trades, chartbook, calculator, analysis, notes
  /ui        공통 컴포넌트, 테마 토큰(tokens.css), 앱 셸, 라우팅
/gas         Apps Script 소스 (.js, clasp가 .gs로 올림), appsscript.json. 배포·API는 gas/README.md
/tests       core 단위 테스트 (/tests/core), GAS를 가짜 서비스로 돌리는 테스트 (/tests/gas)
```

## 도메인 용어

- 포지션: 한 종목의 진입부터 전량 청산까지. 상태 planned → open → review_pending → done
- 계획(Plan): 진입 전 thesis, 무효화 조건, 계획 진입가·손절가·수량, RPT%, 계산기 스냅샷
- 체결(Fill): 매수·매도 1건. 분할매수·분할매도는 여러 행
- 복기(Review): 청산 후 규칙 체크리스트, 실행 등급, 실수·감정 태그, 잘한 점·개선점
- 차트북: 포지션에 붙는 이미지 묶음. 슬롯 ①셋업 ②진입 ③청산(필수) ④사후 복기 + 자유 첨부
- R: 원 손절가 기준. 1R 금액 = 계획 리스크 금액, 없으면 1차 진입 수량 × |1차 평균가 − 원 손절가|
- RPT%: 계좌 대비 1회 리스크 (기본 1.25%)
- 피라미딩 단계: 같은 포지션의 1차·2차·3차 진입
- 실행 등급 A–D: 규칙 준수율로 자동 산출 (100% A, 80% 이상 B, 60% 이상 C, 미만 D, 무계획 진입은 최대 C)

## 불변 규칙

- 화면은 `src/data/repo.ts`의 `LocalRepo`(Zustand `useData`로 얻음)로만 읽고 쓴다. 네트워크는 `SyncEngine`만 쓴다.
  - 모든 쓰기는 IndexedDB + outbox에 같은 트랜잭션으로 들어가고, 삭제는 `deleted=true` 소프트 삭제.
  - 엔티티·필드 이름은 `gas/Config.js`와 `src/data/types.ts`가 같아야 한다 (서버는 모르는 필드를 거부). 필드 추가는 둘 다 고친다.
- R은 항상 원 손절가 기준. 손절 이동 후에도 바뀌지 않는다.
- 손익·R·MFE/MAE는 저장하지 않고 체결과 시세 캐시에서 계산한다.
- `/src/core`는 순수 함수, 모든 함수에 Vitest 테스트.
- 매매내역 자동 수집(SMS·API·CSV)은 범위 밖. 체결은 수동 입력.
- 추세추종 콕핏 앱과의 연동은 범위 밖.
- 손익 색은 KR 관례: 수익·상승 빨강 `--profit`, 손실·하락 파랑 `--loss` (US 종목도 동일).
- 라이트 테마 기본. 색은 `src/ui/tokens.css`의 CSS 변수만 쓴다 (컴포넌트에 hex 직접 쓰지 않기).
  - 초록 `--brand`는 브랜드·버튼·선택 상태 전용. 손익에 쓰지 않는다.
- 글꼴: 본문 IBM Plex Sans KR, 숫자 JetBrains Mono (`.num` 클래스). 통화 기호와 R 단위 항상 함께 표기. 숫자 포맷은 `src/core/format.ts`.
- 터치 영역 최소 44px. 900px 미만은 하단 탭, 이상은 왼쪽 사이드바.

## 작업 방식

- 코드 작성 전 계획을 보여주고 승인받는다. 선택지가 있으면 2개 안을 제시하고 기다린다.
- 각 작업 끝에 "건드리지 말 것" 목록 회귀 확인 결과를 보고한다.
- GAS 변경 시 변경된 .gs 파일 목록과 배포 절차(새 버전 배포 필요 여부)를 정리한다.
- 시트에 쓰기 전 백업이 필요한 작업(이관·스키마 변경)은 백업 함수 실행을 먼저 안내한다.
