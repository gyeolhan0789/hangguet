package com.ssafy.a301.application;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.assertj.MockMvcTester;
import org.springframework.test.web.servlet.assertj.MvcTestResult;

@SpringBootTest
@AutoConfigureMockMvc
class ApplicationTest {

    private static final String ITEM =
            "{ \"question\": \"지원 동기\", \"answer\": \"저는 서버를 만들고 싶어 지원했습니다.\" }";

    @Autowired private MockMvcTester mockMvc;

    @Test
    void createsWithCoverLetterItems() {
        MvcTestResult result = create(body("[" + ITEM + "]"));
        assertThat(result).hasStatus(HttpStatus.CREATED);
        assertThat(result)
                .bodyJson()
                .extractingPath("$.coverLetterItems[0].itemOrder")
                .isEqualTo(1);
        assertThat(result)
                .bodyJson()
                .extractingPath("$.coverLetterItems[0].question")
                .isEqualTo("지원 동기");
        assertThat(result)
                .bodyJson()
                .extractingPath("$.coverLetterItems[0].answer")
                .isEqualTo("저는 대용량 트래픽을 안정적으로 처리하는 서버를 만들고 싶어 ○○전자 백엔드 직무에 지원했습니다.");
        assertThat(result).bodyJson().doesNotHavePath("$.inUse");
    }

    @Test
    void acceptsFiveItemsAndLongAnswers() {
        String item =
                "{ \"question\": \""
                        + "가".repeat(255)
                        + "\", \"answer\": \""
                        + "가".repeat(20000)
                        + "\" }";
        String five = String.join(",", item, item, item, item, item);
        assertThat(create(body("[" + five + "]"))).hasStatus(HttpStatus.CREATED);
    }

    // 문항 수는 coverLetterItems, 원소 null은 coverLetterItems[i], 칸은 coverLetterItems[i].question ·
    // answer
    static Stream<Arguments> missingOrBlankItems() {
        return Stream.of(
                Arguments.of("[]", "coverLetterItems"),
                Arguments.of("null", "coverLetterItems"),
                Arguments.of("[ null ]", "coverLetterItems[0]"),
                Arguments.of(
                        "[ { \"question\": \"\", \"answer\": \"답변\" } ]",
                        "coverLetterItems[0].question"),
                Arguments.of(
                        "[ { \"question\": \"문항\", \"answer\": \" \" } ]",
                        "coverLetterItems[0].answer"),
                Arguments.of("[ { \"question\": \"문항\" } ]", "coverLetterItems[0].answer"));
    }

    @ParameterizedTest
    @MethodSource("missingOrBlankItems")
    void rejectsMissingOrBlankItems(String items, String field) {
        MvcTestResult result = create(body(items));
        assertThat(result)
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("VALIDATION_FAILED");
        assertThat(result).bodyJson().extractingPath("$.errors[0].field").isEqualTo(field);
    }

    @Test
    void rejectsMoreThanFiveItemsOrTooLongText() {
        String six = String.join(",", ITEM, ITEM, ITEM, ITEM, ITEM, ITEM);
        String longQuestion = "{ \"question\": \"" + "가".repeat(256) + "\", \"answer\": \"답변\" }";
        String longAnswer = "{ \"question\": \"문항\", \"answer\": \"" + "가".repeat(20001) + "\" }";
        Map<String, String> fieldByItems =
                Map.of(
                        "[" + six + "]", "coverLetterItems",
                        "[" + longQuestion + "]", "coverLetterItems[0].question",
                        "[" + longAnswer + "]", "coverLetterItems[0].answer");
        fieldByItems.forEach(
                (items, field) -> {
                    MvcTestResult result = create(body(items));
                    assertThat(result)
                            .hasStatus(HttpStatus.BAD_REQUEST)
                            .bodyJson()
                            .extractingPath("$.code")
                            .isEqualTo("VALIDATION_FAILED");
                    assertThat(result)
                            .bodyJson()
                            .extractingPath("$.errors[0].field")
                            .isEqualTo(field);
                });
    }

    @Test
    void getReturnsItemsInOrder() {
        MvcTestResult first = mockMvc.get().uri("/api/v1/applications/12").exchange();
        assertThat(first).hasStatusOk();
        assertThat(first)
                .bodyJson()
                .extractingPath("$.coverLetterItems[*].itemOrder")
                .asArray()
                .containsExactly(1, 2);
        MvcTestResult used = mockMvc.get().uri("/api/v1/applications/9").exchange();
        assertThat(used).bodyJson().extractingPath("$.companyName").isEqualTo("△△소프트");
        assertThat(first).bodyJson().doesNotHavePath("$.inUse");
        assertThat(used).bodyJson().doesNotHavePath("$.inUse");
        assertThat(mockMvc.get().uri("/api/v1/applications/0").exchange())
                .hasStatus(HttpStatus.NOT_FOUND);
    }

    @Test
    void listHasNoCoverLetter() {
        MvcTestResult result = mockMvc.get().uri("/api/v1/applications").exchange();
        assertThat(result).hasStatusOk();
        assertThat(result)
                .bodyJson()
                .extractingPath("$.content[*].id")
                .asArray()
                .containsExactly(12, 9);
        assertThat(result).bodyJson().doesNotHavePath("$.content[0].coverLetterItems");
    }

    @Test
    void listPageBeyondRangeIsEmptyWithTotal() {
        MvcTestResult result =
                mockMvc.get().uri("/api/v1/applications?page=2147483647&size=20").exchange();
        assertThat(result).hasStatusOk();
        assertThat(result).bodyJson().extractingPath("$.content").asArray().isEmpty();
        assertThat(result).bodyJson().extractingPath("$.page.totalElements").isEqualTo(2);
    }

    @Test
    void deletesEvenUsedApplication() {
        assertThat(mockMvc.delete().uri("/api/v1/applications/9").exchange())
                .hasStatus(HttpStatus.NO_CONTENT);
        assertThat(mockMvc.delete().uri("/api/v1/applications/0").exchange())
                .hasStatus(HttpStatus.NOT_FOUND);
    }

    @Test
    void noUpdateApi() {
        assertThat(
                        mockMvc.patch()
                                .uri("/api/v1/applications/12")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{ \"companyName\": \"○○전자\" }")
                                .exchange())
                .hasStatus(HttpStatus.METHOD_NOT_ALLOWED);
    }

    @Test
    void listsSessionsOfApplicationNewestFirst() {
        MvcTestResult result = sessions(12, "");
        assertThat(result).hasStatusOk();
        assertThat(result)
                .bodyJson()
                .extractingPath("$.content[*].id")
                .asArray()
                .containsExactly(55, 52);
        assertThat(result).bodyJson().extractingPath("$.page.totalElements").isEqualTo(2);
        assertThat(sessions(9, ""))
                .bodyJson()
                .extractingPath("$.content[*].status")
                .asArray()
                .containsExactly("ANALYZING", "FAILED");
    }

    @Test
    void sessionsPageAndEmptyApplication() {
        MvcTestResult second = sessions(12, "?page=1&size=1");
        assertThat(second).bodyJson().extractingPath("$.content[0].id").isEqualTo(52);
        assertThat(second).bodyJson().extractingPath("$.page.totalPages").isEqualTo(2);
        assertThat(sessions(13, ""))
                .hasStatusOk()
                .bodyJson()
                .extractingPath("$.content")
                .asArray()
                .isEmpty();
        assertThat(sessions(0, "")).hasStatus(HttpStatus.NOT_FOUND);
    }

    @ParameterizedTest
    @MethodSource("invalidSessionQueries")
    void sessionsRejectInvalidQueries(String query, String field) {
        MvcTestResult result = sessions(12, query);
        assertThat(result)
                .hasStatus(HttpStatus.BAD_REQUEST)
                .bodyJson()
                .extractingPath("$.code")
                .isEqualTo("VALIDATION_FAILED");
        assertThat(result).bodyJson().extractingPath("$.errors[0].field").isEqualTo(field);
    }

    static Stream<Arguments> invalidSessionQueries() {
        return Stream.of(
                Arguments.of("?page=-1", "page"),
                Arguments.of("?size=0", "size"),
                Arguments.of("?size=21", "size"));
    }

    private static String body(String items) {
        return "{ \"companyName\": \"○○전자\", \"jobTitle\": \"백엔드 개발자\", \"coverLetterItems\": "
                + items
                + " }";
    }

    private MvcTestResult create(String body) {
        return mockMvc.post()
                .uri("/api/v1/applications")
                .contentType(MediaType.APPLICATION_JSON)
                .content(body)
                .exchange();
    }

    private MvcTestResult sessions(long applicationId, String query) {
        return mockMvc.get()
                .uri("/api/v1/applications/" + applicationId + "/interview-sessions" + query)
                .exchange();
    }
}
