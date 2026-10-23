package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.YearMonth;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@SpringBootTest
@AutoConfigureMockMvc
class InterviewCalendarTest {

    @Autowired private MockMvcTester mockMvc;
    @Autowired private ObjectMapper objectMapper;

    @Test
    void countsMatchDailyHistoryIncludingFailedAnalyzingAndOvernightSessions() throws Exception {
        JsonNode response = body(calendar("month=2026-10"));
        assertThat(response.get("month").asString()).isEqualTo("2026-10");
        assertThat(response.get("content").size()).isEqualTo(31);
        for (int day = 1; day <= 31; day++) {
            String date = YearMonth.of(2026, 10).atDay(day).toString();
            JsonNode entry = response.get("content").get(day - 1);
            JsonNode daily =
                    body(
                            mockMvc.get()
                                    .uri(
                                            "/api/v1/interview-sessions?practiceDate="
                                                    + date
                                                    + "&size=1")
                                    .exchange());
            assertThat(entry.get("practiceDate").asString()).isEqualTo(date);
            assertThat(entry.get("interviewCount").asLong())
                    .isEqualTo(daily.get("page").get("totalElements").asLong());
        }
        assertThat(response.get("content").get(19).get("interviewCount").asLong()).isEqualTo(2);
        assertThat(response.get("content").get(20).get("interviewCount").asLong()).isEqualTo(2);
        assertThat(response.get("content").get(21).get("interviewCount").asLong()).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"2026-09", "2028-02", "2026-02", "0001-01", "9999-12"})
    void emptyMonthsIncludeEveryDateInOrderIncludingLeapDayAndYearBoundaries(String month)
            throws Exception {
        JsonNode response = body(calendar("month=" + month));
        YearMonth selected = YearMonth.parse(month);
        assertThat(response.get("month").asString()).isEqualTo(month);
        assertThat(response.get("content").size()).isEqualTo(selected.lengthOfMonth());
        for (int day = 1; day <= selected.lengthOfMonth(); day++) {
            JsonNode entry = response.get("content").get(day - 1);
            assertThat(entry.get("practiceDate").asString())
                    .isEqualTo(selected.atDay(day).toString());
            assertThat(entry.get("interviewCount").asLong()).isZero();
        }
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "",
                "month=",
                "month=bad",
                "month=2026-1",
                "month=026-01",
                "month=10000-01",
                "month=0000-01",
                "month=-001-01",
                "month=2026-00",
                "month=2026-13",
                "month=2026-10-01",
                "month=2026-10T00:00:00",
                "month=%202026-10",
                "month=2026-10%20"
            })
    void rejectsInvalidOrMissingMonth(String query) {
        assertThat(calendar(query))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void followsMockConventionWithoutCheckingBearerToken() {
        assertThat(calendar("month=2026-10")).hasStatus(HttpStatus.OK);
        assertThat(
                        mockMvc.get()
                                .uri("/api/v1/interview-sessions/calendar?month=2026-10")
                                .header("Authorization", "Bearer mock-token"))
                .hasStatus(HttpStatus.OK);
    }

    private MvcTestResult calendar(String query) {
        return mockMvc.get().uri("/api/v1/interview-sessions/calendar?" + query).exchange();
    }

    private JsonNode body(MvcTestResult result) throws Exception {
        assertThat(result).hasStatus(HttpStatus.OK);
        return objectMapper.readTree(result.getResponse().getContentAsString());
    }
}
