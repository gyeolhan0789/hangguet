import { useEffect, useState } from 'react'

// 라우터 라이브러리 없이 주소의 # 뒤로 화면을 고른다
export type Route =
  | { name: 'home' }
  | { name: 'notices' }
  | { name: 'notice-new' }
  | { name: 'notice-edit'; id: number }
  | { name: 'grants' }
  | { name: 'grant-new' }

function parse(hash: string): Route {
  if (hash === '#/notices') return { name: 'notices' }
  if (hash === '#/notices/new') return { name: 'notice-new' }
  const edit = /^#\/notices\/(\d+)\/edit$/.exec(hash)
  if (edit) return { name: 'notice-edit', id: Number(edit[1]) }
  if (hash === '#/streak-freezes') return { name: 'grants' }
  if (hash === '#/streak-freezes/new') return { name: 'grant-new' }
  return { name: 'home' }
}

function toHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/'
    case 'notices':
      return '#/notices'
    case 'notice-new':
      return '#/notices/new'
    case 'notice-edit':
      return `#/notices/${route.id}/edit`
    case 'grants':
      return '#/streak-freezes'
    case 'grant-new':
      return '#/streak-freezes/new'
  }
}

export function navigate(route: Route | Exclude<Route['name'], 'notice-edit'>) {
  const next = typeof route === 'string' ? ({ name: route } as Route) : route
  window.location.hash = toHash(next)
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
