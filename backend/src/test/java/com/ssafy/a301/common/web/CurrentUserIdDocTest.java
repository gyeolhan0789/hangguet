package com.ssafy.a301.common.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

/**
 * @CurrentUserId·@CurrentAdminId 인자가 Swagger 요청 파라미터로 드러나지 않는지 본다
 */
@SpringBootTest
@AutoConfigureMockMvc
class CurrentUserIdDocTest {
    @Autowired private MockMvc mvc;

    @Test
    void loginIdsAreNotSwaggerParameters() throws Exception {
        String docs =
                mvc.perform(get("/v3/api-docs")).andReturn().getResponse().getContentAsString();

        assertThat(docs)
                .contains("/api/v1/users/me", "/api/v1/admin/notices")
                .doesNotContain("\"name\":\"userId\",\"in\":\"query\"")
                .doesNotContain("\"name\":\"adminId\",\"in\":\"query\"");
    }
}
