package com.ssafy.a301.interview;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

@SpringBootTest
@AutoConfigureMockMvc
class InterviewHistoryTest {

    @Autowired private MockMvcTester mockMvc;

    @Test
    void includesCompletedAndAnalyzingCardsWithoutLoadingResults() {
        MvcTestResult result = list("practiceDate=2026-10-21");
        assertThat(result).hasStatus(HttpStatus.OK);
        assertThat(result)
                .bodyJson()
                .extractingPath("$.content[*].id")
                .asArray()
                .containsExactly(55, 54);
        assertThat(result)
                .bodyJson()
                .extractingPath("$.content[0].summary")
                .isEqualTo("논리는 탄탄했지만, 근거가 조금 아쉬웠어요");
        assertThat(result)
                .bodyJson()
                .extractingPath("$.content[0].criterionGrades")
                .asArray()
                .hasSize(4);
        assertThat(result).bodyJson().extractingPath("$.content[1].summary").isNull();
        assertThat(result)
                .bodyJson()
                .extractingPath("$.content[1].criterionGrades")
                .asArray()
                .isEmpty();
    }

    @Test
    void pagingPreservesWholeDayAndArchiveAggregates() {
        MvcTestResult first = list("practiceDate=2026-10-21&page=0&size=1");
        MvcTestResult second = list("practiceDate=2026-10-21&page=1&size=1");
        assertThat(first).bodyJson().extractingPath("$.content[0].id").isEqualTo(55);
        assertThat(second).bodyJson().extractingPath("$.content[0].id").isEqualTo(54);
        for (MvcTestResult result : new MvcTestResult[] {first, second}) {
            assertThat(result).bodyJson().extractingPath("$.page.totalElements").isEqualTo(2);
            assertThat(result).bodyJson().extractingPath("$.page.totalPages").isEqualTo(2);
            assertThat(result)
                    .bodyJson()
                    .extractingPath("$.summary.totalInterviewCount")
                    .isEqualTo(4);
            assertThat(result).bodyJson().extractingPath("$.summary.practiceMinutes").isEqualTo(32);
        }
        MvcTestResult beyond = list("practiceDate=2026-10-21&page=2147483647&size=20");
        assertThat(beyond)
                .hasStatus(HttpStatus.OK)
                .bodyJson()
                .extractingPath("$.content")
                .asArray()
                .isEmpty();
        assertThat(beyond).bodyJson().extractingPath("$.summary.practiceMinutes").isEqualTo(32);
    }

    @Test
    void separatesFailedFromCompletedWithoutSummary() {
        MvcTestResult result = list("practiceDate=2026-10-20");
        assertThat(result).hasStatus(HttpStatus.OK);
        assertThat(result).bodyJson().extractingPath("$.content[0].status").isEqualTo("FAILED");
        assertThat(result)
                .bodyJson()
                .extractingPath("$.content[0].criterionGrades")
                .asArray()
                .isEmpty();
        assertThat(result).bodyJson().extractingPath("$.content[1].status").isEqualTo("COMPLETED");
        assertThat(result).bodyJson().extractingPath("$.content[1].summary").isNull();
        assertThat(result)
                .bodyJson()
                .extractingPath("$.content[1].criterionGrades")
                .asArray()
                .hasSize(4);
    }

    @Test
    void emptyDateReturnsArchiveCountAndNoPracticeTime() {
        MvcTestResult result = list("practiceDate=2026-10-19");
        assertThat(result)
                .hasStatus(HttpStatus.OK)
                .bodyJson()
                .extractingPath("$.content")
                .asArray()
                .isEmpty();
        assertThat(result).bodyJson().extractingPath("$.page.totalPages").isEqualTo(0);
        assertThat(result).bodyJson().extractingPath("$.summary.totalInterviewCount").isEqualTo(4);
        assertThat(result).bodyJson().extractingPath("$.summary.practiceMinutes").isEqualTo(0);
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "",
                "practiceDate=bad",
                "practiceDate=2026-02-30",
                "practiceDate=2026-10-21&page=-1",
                "practiceDate=2026-10-21&size=0",
                "practiceDate=2026-10-21&size=21"
            })
    void rejectsInvalidQueries(String query) {
        assertThat(list(query))
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("VALIDATION_FAILED");
    }

    @Test
    void overnightInterviewBelongsToStartDateAndDefaultPageHasFiveItems() {
        MvcTestResult started = list("practiceDate=2026-10-21");
        assertThat(started).hasStatus(HttpStatus.OK);
        assertThat(started).bodyJson().extractingPath("$.page.size").isEqualTo(5);
        assertThat(started)
                .bodyJson()
                .extractingPath("$.content[0].endedAt")
                .isEqualTo("2026-10-22T00:10:00+09:00");
        assertThat(list("practiceDate=2026-10-22"))
                .hasStatus(HttpStatus.OK)
                .bodyJson()
                .extractingPath("$.content")
                .asArray()
                .isEmpty();
    }

    @Test
    void calendarUsesStartDatesByDefaultAndDoesNotAddOvernightEndDate() {
        assertThat(mockMvc.get().uri("/api/v1/practice-logs?month=2026-10"))
                .hasStatus(HttpStatus.OK)
                .bodyJson()
                .extractingPath("$.content[*].practiceDate")
                .asArray()
                .containsExactly("2026-10-20", "2026-10-21");
        assertThat(mockMvc.get().uri("/api/v1/practice-logs?month=2026-09"))
                .hasStatus(HttpStatus.OK)
                .bodyJson()
                .extractingPath("$.content")
                .asArray()
                .isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"STARTED_AT", "ENDED_AT", "UNKNOWN"})
    void removedDateBasisParameterCannotSwitchCalendarBackToEndDates(String legacyBasis) {
        assertThat(
                        mockMvc.get()
                                .uri(
                                        "/api/v1/practice-logs?month=2026-10&dateBasis="
                                                + legacyBasis))
                .hasStatus(HttpStatus.OK)
                .bodyJson()
                .extractingPath("$.content[*].practiceDate")
                .asArray()
                .containsExactly("2026-10-20", "2026-10-21");
    }

    private MvcTestResult list(String query) {
        return mockMvc.get().uri("/api/v1/interview-sessions?" + query).exchange();
    }
}
