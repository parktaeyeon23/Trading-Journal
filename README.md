# ALPHA JOURNAL

KR·US 현물 단기 추세추종 매매를 기록·복기하는 개인용 투자일지 PWA.
계획 → 체결 → 복기(차트북 필수) 흐름, 캘린더 손익 히트맵, 분석 탭, R 기반 사이징 계산기를 한 앱에 담는다.

앱 주소: https://parktaeyeon23.github.io/Trading-Journal/

## 처음 쓰는 순서

1. **백엔드 배포** — `gas/README.md`의 "처음 배포"를 따른다 (`setupSheets` → `testApi_all` → `installBackupTrigger` → `installMarketTrigger` → 웹앱 배포).
2. **앱 연결** — 앱의 설정(톱니바퀴) → 백엔드에 웹앱 URL과 `API_SECRET`을 넣고 "연결 테스트" → 저장.
   - URL과 secret은 그 기기에만 저장된다. 저장소·채팅·스크린샷에 올리지 않는다.
3. **설정값** — 시장별 계좌 규모, 기본 RPT%, 수수료·세금 요율, 비중·오픈 리스크 상한을 넣는다.
4. **기기마다 설치** (아래).

## 설치 (홈 화면 앱)

| 기기 | 방법 |
| --- | --- |
| iPhone·iPad | **Safari**로 앱 주소 열기 → 공유 버튼 → "홈 화면에 추가". (Chrome 앱에서는 설치되지 않는다) |
| Android | Chrome으로 열기 → 메뉴 ⋮ → "앱 설치" 또는 "홈 화면에 추가" |
| PC (Chrome·Edge) | 주소창 오른쪽 설치 아이콘 → 설치 |

- 설치하면 오프라인에서도 열리고, 기록·복기·계산기가 동작한다. 변경은 기기에 먼저 저장됐다가 연결되면 시트로 올라간다.
- 새 버전이 배포되면 아래쪽에 "새 버전이 있습니다" 배너가 뜬다. 입력 중인 것을 저장하고 "새로고침"을 누른다.
- 차트 이미지는 Drive에 **링크가 있는 모든 사용자** 공개로 저장된다. 계좌번호·잔고가 보이는 화면은 올리지 않는다.

## 백업과 복원

- **서버**: 매일 새벽 3시 무렵 "ALPHA JOURNAL/backup" 폴더에 스프레드시트 사본이 생긴다 (최근 30일 + 달마다 마지막 사본 보관). 시트를 통째로 되돌릴 때는 사본을 열어 시트를 복사하거나, 사본의 ID를 스크립트 속성 `SPREADSHEET_ID`에 넣는다.
- **기기**: 설정 → 데이터 백업 → "전체 내보내기(JSON)" / "포지션·체결 CSV".
- **복원**: 설정 → "JSON에서 복원" (확인 두 번). 이 기기 데이터를 파일 내용으로 바꾸고 전부 서버로 다시 보낸다. 서버에 더 최신인 기록이 있으면 서버 쪽이 남는다.
- 시험 데이터(`npm run seed`)는 백엔드가 연결되지 않은 브라우저에서만 복원한다. 연결된 곳에 복원하면 시트로 올라간다.

## 실사용 전 기기 점검 (자동 테스트로 확인할 수 없는 것)

- [ ] 폰과 PC에 설치되고, 비행기 모드에서 앱이 열린다
- [ ] 폰에서 갤러리 사진을 ③ 청산 슬롯에 올림 → PC 같은 트레이드에서 썸네일이 보인다 (iPhone Safari 포함)
- [ ] 폰에서 비행기 모드로 체결 입력 → 연결 후 PC에 나타난다
- [ ] 두 기기에서 같은 트레이드를 고침 → 최신 것이 남고, 다른 쪽은 설정 → 충돌 기록에 남는다
- [ ] 다음 날 Drive "ALPHA JOURNAL/backup"에 사본이 생겼다 (Apps Script 왼쪽 시계 아이콘에서 트리거 실행 기록도 확인)
- [ ] 다음 날 아침 캘린더 날짜 상세에 지수 등락이 나온다 (`installMarketTrigger`)
- [ ] 계산기 "가격 불러오기"가 KR 6자리 코드·US 티커 모두 된다

## 개발

```bash
npm install
npm run dev        # 개발 서버
npm test           # 단위 테스트 (core, data, GAS 가짜 서비스)
npm run coverage   # core 커버리지
npm run lint       # oxlint
npm run build      # 타입 체크 + 프로덕션 빌드 (dist/)
npm run preview    # 빌드 결과 미리보기
npm run seed -- 500 > seed.json   # 시험 데이터 (내보내기 형식)
python3 scripts/make_icons.py     # 앱 아이콘 PNG 다시 만들기 (Playwright 필요)
```

- 빌드 base는 기본 `/Trading-Journal/`. 다른 경로에 올릴 때는 `BASE=/ npm run build`.
- `.github/workflows/deploy.yml`이 `main` 푸시마다 테스트·빌드 후 Pages에 올린다 (Settings → Pages → Source "GitHub Actions").
- GAS 코드를 고치면 `gas/README.md`의 "코드를 고친 뒤"대로 새 버전을 배포한다.

## 구조

| 폴더 | 내용 |
| --- | --- |
| `src/core` | 손익·R·사이징·등급·캘린더·분석 계산 (순수 함수, 전부 테스트) |
| `src/data` | 백엔드 어댑터, IndexedDB 캐시, 동기화, 업로드 큐 |
| `src/features` | 화면별 기능 (calendar, trades, chartbook, calculator, analysis, notes, settings) |
| `src/ui` | 디자인 토큰, 앱 셸, 공통 컴포넌트 |
| `gas` | Apps Script 백엔드 |
| `tests` | 단위 테스트 |
| `scripts` | 시험 데이터, 아이콘 생성 |

작업 규칙은 `CLAUDE.md`, 변경 이력은 `CHANGELOG.md`.

## 나중에 백엔드를 옮길 때 (예: Postgres·Supabase)

앱은 `src/data/backend.ts`의 `BackendAdapter` 인터페이스에만 의존한다. 옮길 때 바꾸는 곳:

1. **새 어댑터** — `BackendAdapter`를 구현하는 클래스 하나 (`src/data/gasAdapter.ts`가 예시).
   - `pullAll(since)`: 서버가 찍은 `synced_at`이 `since` 이후인 행 (삭제 포함).
   - `batch(ops)`: id 기준 upsert, `updated_at`이 더 최신일 때만 덮어쓰기, 오래된 쓰기는 `conflicts`로 돌려주기 (`gas/Merge.js`의 규칙과 같게).
   - `getQuote`·`getBars`(시세, MarketCache 저장), `uploadImage`(이미지 저장 후 ChartImages 행 반환).
2. **어댑터 선택** — `src/data/dataStore.ts`의 `makeAdapter`.
3. **스키마** — 엔티티·필드는 `src/data/types.ts`와 `gas/Config.js`가 기준. 테이블 1개 = 엔티티 1개, 공통 열 `id, created_at, updated_at, deleted, schema_version, synced_at`.
4. **데이터 이전** — 앱에서 "전체 내보내기(JSON)" → 새 백엔드 연결 → "JSON에서 복원"이면 전부 새 서버로 올라간다. 차트 이미지는 Drive에 그대로 두거나, `file_id`로 내려받아 옮긴다.

화면·계산 코드(`src/core`, `src/features`)는 바꿀 필요가 없다.
