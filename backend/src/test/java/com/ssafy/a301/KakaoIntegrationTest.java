package com.ssafy.a301;

import com.ssafy.a301.alarm.kakao.KakaoMessageClient;
import com.ssafy.a301.auth.oauth.KakaoLoginClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.annotation.Transactional;

/**
 * 카카오 API를 가짜로 두는 통합 테스트(연습 알림 · 소셜 계정 연결). 가짜 빈을 여기 한곳에 둬 두 테스트가 Spring 컨텍스트를 함께 쓴다(컨텍스트마다 DB 연결을
 * 따로 잡으므로). 로컬은 docker compose의 PostgreSQL · Redis가 필요하다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
public abstract class KakaoIntegrationTest {
    @MockitoBean protected KakaoMessageClient kakao;
    // 1.6 로그인이 제공자 목록을 만들 때 provider()가 필요해 진짜 객체를 감싼다
    @MockitoSpyBean protected KakaoLoginClient kakaoLogin;
}
