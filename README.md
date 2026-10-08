# ALPHA JOURNAL

KR·US 현물 단기 추세추종 매매를 기록·복기하는 개인용 투자일지 PWA.
계획 → 체결 → 복기(차트북 필수) 흐름, 캘린더 손익 히트맵, R 기반 사이징 계산기를 한 앱에 담는다.

## 실행

```bash
npm install
npm run dev        # 개발 서버
npm test           # 단위 테스트 (src/core)
npm run coverage   # core 커버리지
npm run build      # 타입 체크 + 프로덕션 빌드 (dist/)
npm run preview    # 빌드 결과 미리보기
```

## 배포 (GitHub Pages)

- 빌드 base는 기본 `/Trading-Journal/` (저장소 이름). 다른 경로에 올릴 때는 `BASE=/ npm run build`.
- `.github/workflows/deploy.yml`이 `main` 푸시마다 빌드해서 Pages에 올린다.
  - 처음 한 번: 저장소 Settings → Pages → Source를 "GitHub Actions"로 설정.

## 백엔드 (Step 1 이후)

Google Apps Script 웹앱 + Google Sheets + Google Drive. 코드는 `/gas`, 배포 절차는 Step 1에서 `gas/README.md`에 정리한다.
웹앱 URL과 secret은 앱 설정 화면에서 입력하며, 저장소에는 넣지 않는다.

## 구조

| 폴더 | 내용 |
| --- | --- |
| `src/core` | 손익·R·사이징·등급 계산 (순수 함수) |
| `src/data` | 백엔드 어댑터, IndexedDB 캐시, 동기화 |
| `src/features` | 화면별 기능 |
| `src/ui` | 디자인 토큰, 앱 셸, 공통 컴포넌트 |
| `gas` | Apps Script 백엔드 |
| `tests` | 단위 테스트 |

작업 규칙은 `CLAUDE.md`.
