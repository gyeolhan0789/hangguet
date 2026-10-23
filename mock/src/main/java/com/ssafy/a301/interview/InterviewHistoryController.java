package com.ssafy.a301.interview;

import com.ssafy.a301.common.Stub;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.interview.InterviewDtos.PageMetadata;
import com.ssafy.a301.interview.InterviewDtos.SessionCalendarDay;
import com.ssafy.a301.interview.InterviewDtos.SessionCalendarResponse;
import com.ssafy.a301.interview.InterviewDtos.SessionListItem;
import com.ssafy.a301.interview.InterviewDtos.SessionListResponse;
import com.ssafy.a301.interview.InterviewDtos.SessionListSummary;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.ExampleObject;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.time.DateTimeException;
import java.time.Duration;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.core.type.TypeReference;

/** 연습 기록 화면용 고정 예시. DB 없이 날짜 선택·빈 목록·페이지 이동을 확인한다. */
@Tag(name = "5. 면접 진행")
@RestController
@RequestMapping("/api/v1/interview-sessions")
public class InterviewHistoryController {

    private static final ZoneId KOREA = ZoneId.of("Asia/Seoul");
    private static final String ITEMS =
            """
            [
              { "id": 55, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
                "persona": "DEVIL", "mode": "VIDEO", "status": "COMPLETED",
                "startedAt": "2026-10-21T23:50:00+09:00", "endedAt": "2026-10-22T00:10:00+09:00",
                "answeredCount": 5, "summary": "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
                "criterionGrades": [
                  { "criterion": "JOB_FIT", "grade": "GOOD" },
                  { "criterion": "COVER_LETTER", "grade": "WEAK" },
                  { "criterion": "LOGIC", "grade": "GOOD" },
                  { "criterion": "DELIVERY", "grade": "NORMAL" } ] },
              { "id": 54, "companyName": "△△소프트", "jobTitle": "서버 개발자",
                "persona": "COFFEE_CHAT", "mode": "CHAT", "status": "ANALYZING",
                "startedAt": "2026-10-21T19:30:00+09:00", "endedAt": "2026-10-21T19:42:00+09:00",
                "answeredCount": 3, "summary": null, "criterionGrades": [] },
              { "id": 53, "companyName": "△△소프트", "jobTitle": "서버 개발자",
                "persona": "COFFEE_CHAT", "mode": "VIDEO", "status": "FAILED",
                "startedAt": "2026-10-20T21:00:00+09:00", "endedAt": "2026-10-20T21:22:00+09:00",
                "answeredCount": 5, "summary": null, "criterionGrades": [] },
              { "id": 52, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
                "persona": "DEVIL", "mode": "CHAT", "status": "COMPLETED",
                "startedAt": "2026-10-20T20:00:00+09:00", "endedAt": "2026-10-20T20:10:00+09:00",
                "answeredCount": 2, "summary": null,
                "criterionGrades": [
                  { "criterion": "JOB_FIT", "grade": "NORMAL" },
                  { "criterion": "COVER_LETTER", "grade": "NORMAL" },
                  { "criterion": "LOGIC", "grade": "GOOD" },
                  { "criterion": "DELIVERY", "grade": "NORMAL" } ] }
            ]
            """;
    private static final String DAILY =
            """
            { "content": [
              { "id": 55, "companyName": "○○전자", "jobTitle": "백엔드 개발자",
                "persona": "DEVIL", "mode": "VIDEO", "status": "COMPLETED",
                "startedAt": "2026-10-21T23:50:00+09:00", "endedAt": "2026-10-22T00:10:00+09:00",
                "answeredCount": 5, "summary": "논리는 탄탄했지만, 근거가 조금 아쉬웠어요",
                "criterionGrades": [
                  { "criterion": "JOB_FIT", "grade": "GOOD" },
                  { "criterion": "COVER_LETTER", "grade": "WEAK" },
                  { "criterion": "LOGIC", "grade": "GOOD" },
                  { "criterion": "DELIVERY", "grade": "NORMAL" } ] },
              { "id": 54, "companyName": "△△소프트", "jobTitle": "서버 개발자",
                "persona": "COFFEE_CHAT", "mode": "CHAT", "status": "ANALYZING",
                "startedAt": "2026-10-21T19:30:00+09:00", "endedAt": "2026-10-21T19:42:00+09:00",
                "answeredCount": 3, "summary": null, "criterionGrades": [] } ],
              "page": { "size": 5, "number": 0, "totalElements": 2, "totalPages": 1 },
              "summary": { "totalInterviewCount": 4, "practiceMinutes": 32 } }
            """;
    private static final String EMPTY =
            """
            { "content": [], "page": { "size": 5, "number": 0, "totalElements": 0, "totalPages": 0 },
              "summary": { "totalInterviewCount": 4, "practiceMinutes": 0 } }
            """;

    private final List<SessionListItem> examples;

    public InterviewHistoryController(Stub stub) {
        examples = stub.read(ITEMS, new TypeReference<>() {});
    }

    @Operation(
            summary = "5.15 월별 연습 면접 횟수",
            description =
                    "한국 시간 시작 날짜로 본인의 답변 1개 이상인 ANALYZING·COMPLETED·FAILED 면접을 센다."
                            + " 조회 월의 모든 날짜를 오름차순으로 주며 기록이 없는 날짜도 0으로 포함한다."
                            + " 5.13과 같은 목 데이터를 사용한다.")
    @GetMapping("/calendar")
    public SessionCalendarResponse calendar(
            @Parameter(description = "조회 월(YYYY-MM, 연도 0001~9999)", example = "2026-10")
                    @RequestParam
                    String month) {
        YearMonth selected = parseMonth(month);
        Map<LocalDate, Long> counts =
                examples.stream()
                        .map(item -> item.startedAt().atZoneSameInstant(KOREA).toLocalDate())
                        .filter(date -> YearMonth.from(date).equals(selected))
                        .collect(Collectors.groupingBy(date -> date, Collectors.counting()));
        return new SessionCalendarResponse(
                month,
                IntStream.rangeClosed(1, selected.lengthOfMonth())
                        .mapToObj(selected::atDay)
                        .map(date -> new SessionCalendarDay(date, counts.getOrDefault(date, 0L)))
                        .toList());
    }

    private static YearMonth parseMonth(String month) {
        if (!month.matches("[0-9]{4}-[0-9]{2}")) {
            throw new FieldValidationException("month", "YYYY-MM 형식의 유효한 월입니다(연도 0001~9999).");
        }
        try {
            YearMonth parsed = YearMonth.parse(month);
            if (parsed.getYear() == 0) {
                throw new DateTimeException("Year zero is not supported");
            }
            return parsed;
        } catch (DateTimeException ex) {
            throw new FieldValidationException("month", "YYYY-MM 형식의 유효한 월입니다(연도 0001~9999).");
        }
    }

    @Operation(
            summary = "5.13 연습 면접 목록",
            description =
                    "한국 시간 시작 날짜의 연습 면접을 시작 시각·id 내림차순으로 준다. 본인의 답변 1개 이상인"
                            + " ANALYZING·COMPLETED·FAILED만 포함한다. 평가·총평은 6.3 결과의 요약이다."
                            + " summary는 페이지와 무관한 전체 보관함 건수와 선택 날짜 연습 시간을 준다."
                            + " 목 예시는 2026-10-20(실패·총평 없음), 2026-10-21(완료·분석 중), 나머지는 빈 목록이다.")
    @ApiResponse(
            responseCode = "200",
            content =
                    @Content(
                            examples = {
                                @ExampleObject(name = "완료·분석 중", value = DAILY),
                                @ExampleObject(name = "기록 없는 날짜", value = EMPTY)
                            }))
    @GetMapping
    public SessionListResponse list(
            @Parameter(description = "조회할 연습 날짜(YYYY-MM-DD, 한국 시간)", example = "2026-10-21")
                    @RequestParam
                    @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
                    LocalDate practiceDate,
            @Parameter(description = "페이지(0부터)", example = "0")
                    @RequestParam(defaultValue = "0")
                    @Min(value = 0, message = "0 이상입니다.")
                    int page,
            @Parameter(description = "한 페이지 항목 수(1~20)", example = "5")
                    @RequestParam(defaultValue = "5")
                    @Min(value = 1, message = "1~20입니다.")
                    @Max(value = 20, message = "1~20입니다.")
                    int size) {
        List<SessionListItem> daily =
                examples.stream()
                        .filter(
                                item ->
                                        item.startedAt()
                                                .atZoneSameInstant(KOREA)
                                                .toLocalDate()
                                                .equals(practiceDate))
                        .toList();
        long seconds =
                daily.stream()
                        .mapToLong(
                                item ->
                                        Duration.between(item.startedAt(), item.endedAt())
                                                .getSeconds())
                        .sum();
        long offset = (long) page * size;
        return new SessionListResponse(
                daily.stream().skip(offset).limit(size).toList(),
                new PageMetadata(size, page, daily.size(), (daily.size() + size - 1) / size),
                new SessionListSummary(examples.size(), seconds / 60));
    }
}
