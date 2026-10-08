interface PlaceholderProps {
  title: string
  /** Which build step fills this screen (see the Claude Code prompts tab). */
  step: string
  summary: string
}

export function Placeholder({ title, step, summary }: PlaceholderProps) {
  return (
    <>
      <h1 className="page-title">{title}</h1>
      <section className="card">
        <p className="empty" style={{ margin: 0 }}>
          {summary}
        </p>
        <p className="empty" style={{ margin: '8px 0 0', fontSize: 12 }}>
          {step}에서 구현 예정
        </p>
      </section>
    </>
  )
}
