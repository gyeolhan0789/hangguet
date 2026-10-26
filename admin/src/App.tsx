import { useEffect, useState } from 'react'
import { setUnauthorizedHandler } from './api'
import { Header } from './components/Header'
import { GrantFormPage } from './pages/GrantFormPage'
import { GrantListPage } from './pages/GrantListPage'
import { HistoryPage } from './pages/HistoryPage'
import { HomePage } from './pages/HomePage'
import { InquiryDetailPage } from './pages/InquiryDetailPage'
import { InquiryListPage } from './pages/InquiryListPage'
import { LoginPage } from './pages/LoginPage'
import { NoticeFormPage } from './pages/NoticeFormPage'
import { NoticeListPage } from './pages/NoticeListPage'
import { navigate, useRoute } from './route'
import { type AdminSession, clearSession, loadSession, saveSession } from './session'

export default function App() {
  const [session, setSession] = useState<AdminSession | null>(loadSession)
  const route = useRoute()

  // 토큰이 만료됐거나 로그아웃된 토큰이면 로그인 화면(A01)으로
  useEffect(() => {
    setUnauthorizedHandler(() => setSession(null))
  }, [])

  if (!session) {
    return (
      <LoginPage
        onLogin={(next) => {
          saveSession(next)
          setSession(next)
          navigate('home')
        }}
      />
    )
  }

  return (
    <>
      <Header
        route={route}
        adminName={session.admin.name}
        onLogout={() => {
          clearSession()
          setSession(null)
        }}
      />
      <main className="body">
        {route.name === 'home' && <HomePage />}
        {route.name === 'history' && <HistoryPage />}
        {route.name === 'notices' && <NoticeListPage />}
        {route.name === 'notice-new' && <NoticeFormPage key="new" />}
        {route.name === 'notice-edit' && <NoticeFormPage key={route.id} noticeId={route.id} />}
        {route.name === 'grants' && <GrantListPage />}
        {route.name === 'grant-new' && <GrantFormPage />}
        {route.name === 'inquiries' && <InquiryListPage />}
        {route.name === 'inquiry' && <InquiryDetailPage key={route.id} inquiryId={route.id} />}
      </main>
    </>
  )
}
