# gas — Apps Script 백엔드

Step 1에서 채운다: 엔티티별 시트 스키마, `doPost` API(pullAll · upsert · softDelete · getSettings · ping), 검증, LockService, 백업.

clasp로 관리할 때:

```bash
npm i -g @google/clasp
clasp login
clasp create --type standalone --title "ALPHA JOURNAL API" --rootDir gas
clasp push
```

`.clasp.json`(scriptId 포함)은 커밋하지 않는다. secret은 Script Properties에만 둔다.
