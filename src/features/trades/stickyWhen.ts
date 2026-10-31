/**
 * The date and time last picked by hand in a fill or stop sheet. New sheets
 * start from it until the app is reloaded, so entering yesterday's trades the
 * next morning doesn't mean fixing the date on every fill.
 */
let sticky: string | null = null

export const getStickyWhen = () => sticky
export const setStickyWhen = (v: string | null) => {
  sticky = v
}

/** A picked local date-time more than a minute ahead of now. */
export const isFuture = (local: string) => new Date(local).getTime() > Date.now() + 60_000
