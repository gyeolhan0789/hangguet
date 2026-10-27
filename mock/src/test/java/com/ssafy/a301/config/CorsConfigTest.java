package com.ssafy.a301.config;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

/** 허용한 FE 주소만 CORS 사전 요청을 통과하는지 확인한다. */
@SpringBootTest(properties = "mock.cors.allowed-origins=http://fe.test")
@AutoConfigureMockMvc
class CorsConfigTest {

    @Autowired private MockMvcTester mockMvc;

    @Test
    void allowedOriginPasses() {
        assertThat(
                        mockMvc.options()
                                .uri("/api/v1/home")
                                .header(HttpHeaders.ORIGIN, "http://fe.test")
                                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .headers()
                .hasValue(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://fe.test");
    }

    @Test
    void otherOriginIsRejected() {
        assertThat(
                        mockMvc.options()
                                .uri("/api/v1/home")
                                .header(HttpHeaders.ORIGIN, "http://evil.test")
                                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET"))
                .headers()
                .doesNotContainHeader(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN);
    }
}
