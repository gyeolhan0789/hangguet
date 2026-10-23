import { api } from '../api'
import { navigate, type Route } from '../route'

type Props = { route: Route; adminName: string; onLogout: () => void }

/** 헤더는 '한끗' + '관리' 태그, 로그인(A01) 카드는 '한끗 백오피스'(small) */
export function Brand({ name, small = false }: { name?: string; small?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">한</span>
      <span className="brand-name" style={small ? { fontSize: 17 } : undefined}>
        {name ?? '한끗'}
      </span>
      {!name && <span className="tag">관리</span>}
    </div>
  )
}

export function Header({ route, adminName, onLogout }: Props) {
  const current = route.name.startsWith('notice') ? 'notices' : route.name.startsWith('grant') ? 'grants' : 'home'

  // 로그아웃(8.2)이 실패해도 이 화면에서는 토큰을 버린다
  const logout = async () => {
    await api.logout().catch(() => undefined)
    onLogout()
  }

  return (
    <header className="header">
      <Brand />
      <nav className="nav">
        <button
          type="button"
          className="nav-item"
          aria-current={current === 'home' ? 'page' : undefined}
          onClick={() => navigate('home')}
        >
          홈
        </button>
        <button
          type="button"
          className="nav-item"
          aria-current={current === 'notices' ? 'page' : undefined}
          onClick={() => navigate('notices')}
        >
          공지
        </button>
        <button
          type="button"
          className="nav-item"
          aria-current={current === 'grants' ? 'page' : undefined}
          onClick={() => navigate('grants')}
        >
          스트릭 유지권
        </button>
        <span className="nav-divider" />
        <div className="nav-admin">
          <span>{adminName}</span>
          <button type="button" onClick={logout}>
            로그아웃
          </button>
        </div>
      </nav>
    </header>
  )
}
