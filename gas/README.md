# gas — Apps Script 백엔드

ALPHA JOURNAL의 데이터 API. 데이터는 새 스프레드시트 "ALPHA JOURNAL DB"(엔티티별 시트), 차트 이미지는 Drive "ALPHA JOURNAL" 폴더에 둔다.
기존 투자일지 스프레드시트와 그 GAS 프로젝트는 건드리지 않는다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `Config.js` | 엔티티 스키마(시트·열·타입·필수·참조), 기본 설정값 |
| `Validate.js` | 행 검증·변환, 셀 ↔ API 값 변환 (순수 함수) |
| `Merge.js` | updated_at 기준 병합·충돌 판정 (순수 함수) |
| `Sheets.js` | 헤더 이름 기반 시트 읽기·쓰기 |
| `Api.js` | `doPost` 웹앱 API, secret 인증, LockService |
| `Setup.js` | `setupSheets()` 초기 설정(멱등), `backupSpreadsheet()` |
| `Backup.js` | `installBackupTrigger()` 매일 03시 자동 백업 예약, `backupDaily()` 백업 + 오래된 사본 정리 |
| `Tests.js` | 에디터에서 돌리는 `testApi_all()` — 임시 시트로만 실행 |

같은 파일을 Node에서 가짜 서비스로 돌리는 테스트가 `tests/gas/`에 있다 (`npm test`).

## 처음 배포 (한 번)

1. [script.google.com](https://script.google.com) → 새 프로젝트, 이름 "ALPHA JOURNAL API".
2. 이 폴더의 `.js` 파일 8개를 같은 이름의 스크립트 파일로 붙여넣는다 (편집기에서 + → 스크립트). `appsscript.json`은 프로젝트 설정 → "편집기에 appsscript.json 매니페스트 파일 표시"를 켠 뒤 내용을 덮어쓴다.
   - clasp를 쓰면: `npm i -g @google/clasp && clasp login && clasp create --type standalone --title "ALPHA JOURNAL API" --rootDir gas && clasp push`
3. 함수 선택에서 `setupSheets` → 실행. 권한 승인(스프레드시트·Drive)을 한다.
   - 내 Drive에 "ALPHA JOURNAL/ALPHA JOURNAL DB" 스프레드시트가 생긴다.
   - 스크립트 속성에 `SPREADSHEET_ID`, `API_SECRET`이 저장된다.
4. `testApi_all` 실행 → 실행 로그에 PASS 7줄이 나오면 정상. (임시 시트에서만 돌고 지워진다)
5. `installBackupTrigger` 실행 → 매일 새벽 3시 무렵 "ALPHA JOURNAL/backup" 폴더에 DB 사본이 생긴다.
   - 최근 30일 사본은 모두, 그보다 오래된 달은 그 달의 마지막 사본 하나만 남기고 휴지통으로 옮긴다 (영구 삭제는 하지 않음).
   - 다시 실행해도 트리거는 하나만 유지된다. 왼쪽 시계 아이콘(트리거)에서 확인할 수 있다.
6. 배포 → 새 배포 → 유형 "웹 앱"
   - 다음 사용자 인증 정보로 실행: **나**
   - 액세스 권한: **모든 사용자** (앱이 로그인 없이 호출하므로 필요. 대신 모든 요청은 API_SECRET으로 막는다)
7. 나온 웹앱 URL(`.../exec`)과 프로젝트 설정 → 스크립트 속성의 `API_SECRET` 값을 앱의 설정 화면(오른쪽 위·사이드바 아래 톱니바퀴)에 넣고 연결 테스트를 누른다.

`API_SECRET`은 저장소·채팅·스크린샷에 올리지 않는다. 바꾸고 싶으면 스크립트 속성에서 값을 지우고 `setupSheets`를 다시 실행하면 새로 만들어진다.

## 코드를 고친 뒤

- 배포 → 배포 관리 → 연필 → 버전 "새 버전" → 배포. URL은 그대로 유지된다.
- 시트 열이 추가된 변경이면 `setupSheets`를 한 번 더 실행한다 (없는 열만 끝에 추가, 기존 데이터 유지).

## API

모든 요청은 POST, 본문은 JSON 문자열(`Content-Type: text/plain`으로 보내 CORS preflight를 피한다).
응답은 항상 JSON이며 HTTP 상태는 늘 200이므로 `ok`로 판단한다.

```json
{ "secret": "…", "action": "ping" }
{ "secret": "…", "action": "pullAll", "since": "2026-10-08T00:00:00.000Z" }
{ "secret": "…", "action": "upsert", "entity": "Fills", "rows": [ { "id": "…", "created_at": "…", "updated_at": "…", … } ] }
{ "secret": "…", "action": "softDelete", "entity": "Fills", "ids": ["…"] }
{ "secret": "…", "action": "batch", "ops": [ { "op": "upsert", "entity": "Positions", "rows": [] }, { "op": "upsert", "entity": "Fills", "rows": [] } ] }
{ "secret": "…", "action": "getSettings" }
```

| 동작 | 규칙 |
| --- | --- |
| upsert | id 기준. 들어온 `updated_at`이 더 최신이면 덮어쓰기(`created_at`은 서버 값 유지), 같으면 unchanged, 더 오래되면 `conflicts`에 서버 행을 담아 돌려준다 |
| 검증 | 필수 필드·타입·열거값·날짜·참조(예: Fills.position_id가 Positions에 있는지). 실패한 행만 `rejected`에 필드별 사유로 돌려주고 나머지는 저장 |
| softDelete | `deleted=true`, `updated_at`=서버 시각. 행은 지우지 않는다 |
| batch | ops를 순서대로 실행, 앞 op에서 만든 부모를 뒤 op가 참조할 수 있다. 트랜잭션은 아니다 (op 단위로 반영) |
| pullAll | 서버가 `since` 이후에 쓴 행만 (`synced_at` 기준). 응답의 `serverTime`을 다음 `since`로 쓴다. 다른 기기에서 오프라인으로 오래전에 고친 행도 업로드된 시점 기준이라 빠지지 않는다 |
| synced_at | 모든 쓰기에 서버가 찍는 시각. 클라이언트가 보낸 값은 무시하고 덮어쓴다 |
| 한도 | op당 500행. 쓰기와 pullAll은 LockService로 줄 세움, 20초 안에 못 잡으면 `busy` |

에러 코드: `bad_request`, `unauthorized`, `not_setup`, `unknown_action`, `unknown_entity`, `too_many_rows`, `busy`, `internal`.
