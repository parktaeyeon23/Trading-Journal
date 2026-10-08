import { hrefFor } from '../../ui/routes'
import { Placeholder } from '../../ui/Placeholder'
import { useRoute } from '../../ui/useRoute'

export function AnalysisScreen() {
  // The calendar's summary bar opens this tab with a period (#/analysis/2026-10); Step 8 applies it as a filter.
  const { param } = useRoute()
  return (
    <>
      <Placeholder title="분석" step="Step 8" summary="기대값·승률·규율 점수, 셋업별·실수별 분해 리포트, 월말 대조" />
      {param && (
        <p className="help">
          {param} 기간으로 열렸습니다. <a href={hrefFor('calendar', param.length === 7 ? param : undefined)}>캘린더로 돌아가기</a>
        </p>
      )}
    </>
  )
}
