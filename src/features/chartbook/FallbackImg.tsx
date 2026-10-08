import { useState, type ImgHTMLAttributes } from 'react'

/** <img> that tries each src in turn and shows a quiet placeholder if none load. */
export function FallbackImg({ srcs, alt, ...rest }: { srcs: string[]; alt: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const [i, setI] = useState(0)
  if (i >= srcs.length) {
    return (
      <span className="img-missing" role="img" aria-label={`${alt} (불러오지 못함)`}>
        이미지를 불러오지 못했습니다
      </span>
    )
  }
  return <img src={srcs[i]} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setI((n) => n + 1)} {...rest} />
}
