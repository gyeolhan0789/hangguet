import { useEffect, useState } from 'react'

// 라우터 라이브러리 없이 주소의 # 뒤로 화면을 고른다
export type Route = 'home' | 'grants' | 'grant-new'

const PATHS: Record<Route, string> = {
  home: '#/',
  grants: '#/streak-freezes',
  'grant-new': '#/streak-freezes/new',
}

function parse(hash: string): Route {
  const found = (Object.keys(PATHS) as Route[]).find((r) => PATHS[r] === hash)
  return found ?? 'home'
}

export function navigate(route: Route) {
  window.location.hash = PATHS[route]
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
