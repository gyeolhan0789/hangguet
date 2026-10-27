package com.ssafy.a301;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.assertj.MockMvcTester;

/** 애플리케이션이 뜨고 DB에 연결되어 health가 UP인지 확인한다. 로컬은 docker compose의 PostgreSQL이 필요하다. */
@SpringBootTest
@AutoConfigureMockMvc
class HealthCheckTest {

    @Autowired private MockMvcTester mockMvc;

    @Test
    void healthIsUp() {
        assertThat(mockMvc.get().uri("/actuator/health"))
                .hasStatus(HttpStatus.OK)
                .bodyJson()
                .extractingPath("$.status")
                .isEqualTo("UP");
    }
}
