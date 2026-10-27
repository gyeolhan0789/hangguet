package com.ssafy.a301.admin.dto;

import com.ssafy.a301.admin.domain.GrantStatus;
import com.ssafy.a301.admin.domain.GrantTarget;
import com.ssafy.a301.interview.domain.Criterion;
import com.ssafy.a301.interview.domain.Persona;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;

public final class AdminDtos {

    private AdminDtos() {}

    // 8.1 · 8.2 관리자 인증

    public record AdminLoginRequest(
            @Schema(description = "관리자 로그인 아이디", example = "admin", maxLength = 50)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 50, message = "최대 50자입니다.")
                    String loginId,
            @Schema(description = "비밀번호", example = "admin1234", maxLength = 64)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 64, message = "최대 64자입니다.")
                    String password) {}

    @Schema(description = "토큰 응답에 담기는 관리자")
    public record AdminSummary(
            @Schema(description = "관리자 id", example = "1") long id,
            @Schema(description = "로그인 아이디", example = "admin") String loginId,
            @Schema(description = "관리 페이지에 보이는 이름", example = "운영자") String name) {}

    public record AdminTokenResponse(
            @Schema(
                            description =
                                    "관리 API 호출용 액세스 토큰. `Authorization: Bearer {accessToken}`",
                            example = "eyJ…")
                    String accessToken,
            @Schema(description = "액세스 토큰 유효 시간(초)", example = "32400") long expiresIn,
            @Schema(description = "로그인한 관리자") AdminSummary admin) {}

    // 8.3 ~ 8.7 공지 관리

    public record NoticeCreateRequest(
            @Schema(description = "공지 제목", example = "10월 점검 안내", maxLength = 100)
                    @NotBlank(message = "필수 값입니다.")
                    @Size(max = 100, message = "최대 100자입니다.")
                    String title,
            @Schema(description = "공지 본문", example = "10월 30일 02:00~04:00 서비스 점검이 있어요.")
                    @NotBlank(message = "필수 값입니다.")
                    String content,
            @Schema(description = "이 일시부터 사용자에게 보여 준다") @NotNull(message = "필수 값입니다.")
                    OffsetDateTime startsAt,
            @Schema(description = "이 일시까지 보여 준다. 값이 없으면 계속 보여 준다", nullable = true)
                    OffsetDateTime endsAt) {}

    @Schema(description = "보낸 필드만 바꾼다. endsAt은 null을 보내면 지워 계속 보여 준다")
    public record NoticeUpdateRequest(
            @Schema(
                            description = "공지 제목",
                            example = "10월 점검 안내(시간 변경)",
                            maxLength = 100,
                            nullable = true)
                    @Size(min = 1, max = 100, message = "1~100자입니다.")
                    @Pattern(regexp = ".*\\S.*", message = "공백만으로는 바꿀 수 없습니다.")
                    String title,
            @Schema(description = "공지 본문", nullable = true)
                    @Pattern(regexp = "(?s).*\\S.*", message = "공백만으로는 바꿀 수 없습니다.")
                    String content,
            @Schema(description = "게시 시작 일시", nullable = true) OffsetDateTime startsAt,
            // 보내지 않으면 null(그대로), null을 보내면 Optional.empty()(지움). application.yml의
            // spring.jackson.deserialization.USE_NULL_FOR_MISSING_REFERENCE_VALUES가 둘을 구분한다
            @Schema(description = "게시 종료 일시. 보내지 않으면 그대로, null을 보내면 지워 계속 보여 준다", nullable = true)
                    Optional<OffsetDateTime> endsAt) {}

    public record NoticeResponse(
            @Schema(description = "공지 id", example = "3") long id,
            @Schema(description = "공지 제목", example = "10월 점검 안내") String title,
            @Schema(description = "공지 본문") String content,
            @Schema(description = "게시 시작 일시") OffsetDateTime startsAt,
            @Schema(description = "게시 종료 일시. 값이 없으면 계속 보여 준다", nullable = true)
                    OffsetDateTime endsAt,
            @Schema(description = "작성한 관리자 이름", example = "운영자") String adminName,
            @Schema(description = "작성 일시") OffsetDateTime createdAt,
            @Schema(description = "마지막으로 수정한 일시") OffsetDateTime updatedAt) {}

    public record NoticeListItem(
            @Schema(description = "공지 id", example = "3") long id,
            @Schema(description = "공지 제목", example = "10월 점검 안내") String title,
            @Schema(description = "게시 시작 일시") OffsetDateTime startsAt,
            @Schema(description = "게시 종료 일시. 값이 없으면 계속 보여 준다", nullable = true)
                    OffsetDateTime endsAt,
            @Schema(description = "작성 일시") OffsetDateTime createdAt) {}

    // 8.8 · 8.9 공지

    public record NoticeItem(
            @Schema(description = "공지 id", example = "3") long id,
            @Schema(description = "공지 제목", example = "10월 점검 안내") String title,
            @Schema(description = "공지 본문") String content,
            @Schema(description = "게시 시작 일시") OffsetDateTime startsAt,
            @Schema(description = "이 회원이 확인(8.9)했으면 true(확인함), 아니면 false(확인 안 함)") boolean read) {}

    public record NoticesResponse(
            @Schema(description = "게시 중인 공지, 최신순(게시 시작 일시 내림차순). 없으면 빈 배열")
                    List<NoticeItem> content) {}

    // 8.10 ~ 8.12 스트릭 유지권 배포

    public record StreakFreezeGrantRequest(
            @Schema(description = "배포 대상") @NotNull(message = "필수 값입니다.") GrantTarget targetType,
            @Schema(description = "받을 회원 id. 배포 대상이 USERS일 때만 1명 이상 보낸다", nullable = true)
                    List<@NotNull(message = "필수 값입니다.") Long> userIds,
            @Schema(description = "한 사람에게 주는 유지권 개수", example = "1", minimum = "1")
                    @Min(value = 1, message = "1 이상입니다.")
                    int quantity,
            @Schema(description = "이 날짜(한국 시간)에 지급한다. 유효기간은 지급 날짜부터 2주다")
                    @NotNull(message = "필수 값입니다.")
                    LocalDate grantDate,
            @Schema(description = "유지권으로 메울 수 있는 날짜(한국 시간). 받은 회원은 이 날짜만 연습한 날로 메울 수 있다")
                    @NotNull(message = "필수 값입니다.")
                    LocalDate fillableDate,
            @Schema(
                            description = "배포 사유. 관리 페이지에만 보인다",
                            example = "10월 점검 보상",
                            maxLength = 255,
                            nullable = true)
                    @Size(max = 255, message = "최대 255자입니다.")
                    String reason) {}

    public record StreakFreezeGrantResponse(
            @Schema(description = "배포 id", example = "7") long id,
            @Schema(description = "배포 대상") GrantTarget targetType,
            @Schema(
                            description =
                                    "받는 회원 수. 지급함은 실제로 받은 회원 수, 지급 전은 지정 회원 수 또는 지금의 탈퇴하지 않은 회원 수",
                            example = "120")
                    int targetCount,
            @Schema(description = "한 사람에게 주는 개수", example = "1") int quantity,
            @Schema(description = "지급 날짜(한국 시간)") LocalDate grantDate,
            @Schema(description = "메울 수 있는 날짜(한국 시간)") LocalDate fillableDate,
            @Schema(description = "배포 사유", nullable = true) String reason,
            @Schema(description = "배포 상태") GrantStatus status,
            @Schema(description = "배포한 관리자 이름", example = "운영자") String adminName,
            @Schema(description = "배포를 등록한 일시") OffsetDateTime createdAt,
            @Schema(description = "실제로 지급한 일시. 지급 전이면 null", nullable = true)
                    OffsetDateTime grantedAt) {}

    public record AdminUserItem(
            @Schema(description = "회원 id", example = "1") long id,
            @Schema(description = "이메일", example = "a@ssafy.com") String email,
            @Schema(description = "닉네임", example = "면접왕") String nickname,
            @Schema(description = "가입 일시") OffsetDateTime createdAt) {}

    // 8.13 · 8.14 내 스트릭 유지권

    public record StreakFreezeItem(
            @Schema(description = "유지권 id", example = "31") long id,
            @Schema(description = "메울 수 있는 날짜(한국 시간)") LocalDate fillableDate,
            @Schema(description = "지급받은 일시") OffsetDateTime grantedAt,
            @Schema(description = "만료 일시. 지급 날짜부터 2주") OffsetDateTime expiresAt) {}

    public record MyStreakFreezesResponse(
            @Schema(description = "지금 쓸 수 있는 유지권 개수", example = "2") int availableCount,
            @Schema(description = "지금 쓸 수 있는 유지권, 만료가 빠른 순. 없으면 빈 배열")
                    List<StreakFreezeItem> freezes) {}

    public record StreakFreezeUseRequest(
            @Schema(description = "쓸 유지권 id(8.13). 그 유지권의 메울 수 있는 날짜를 메운다", example = "31")
                    @NotNull(message = "필수 값입니다.")
                    Long freezeId) {}

    public record StreakFreezeUseResponse(
            @Schema(description = "메운 날짜(한국 시간). 연습 기록(3.3)과 스트릭에 연습한 날로 들어간다")
                    LocalDate practiceDate,
            @Schema(description = "사용한 유지권 id", example = "31") long freezeId,
            @Schema(description = "남은 유지권 개수", example = "1") int availableCount,
            @Schema(description = "메운 뒤의 현재 스트릭", example = "9") int currentStreak) {}

    // 8.15 관리자 메트릭

    public record UserMetrics(
            @Schema(description = "탈퇴하지 않은 전체 회원 수", example = "120") int total,
            @Schema(description = "기준 날짜(한국 시간)에 가입한 회원 수", example = "3") int joinedToday,
            @Schema(description = "탈퇴한 회원 수", example = "7") int withdrawn,
            @Schema(description = "탈퇴하지 않은 회원 중 연습 면접(답변 1개 이상)을 한 번 이상 한 회원 수", example = "84")
                    int interviewed) {}

    public record Retention(
            @Schema(description = "가입한 날에서 며칠째인지(1 · 3 · 7)", example = "1") int days,
            @Schema(description = "가입한 지 days일이 지난 회원 수(탈퇴 포함)", example = "110") int eligible,
            @Schema(description = "그중 가입한 날에서 정확히 days일째에 연습 기록이 있는 회원 수", example = "38")
                    int returned) {}

    public record DailyPractice(
            @Schema(description = "날짜(한국 시간)") LocalDate date,
            @Schema(description = "그날 연습한 회원 수(연습 기록 기준)", example = "18") int users) {}

    public record PracticeMetrics(
            @Schema(description = "기준 날짜에 연습한 회원 수", example = "18") int practicedToday,
            @Schema(description = "기준 날짜를 포함한 최근 7일 중 하루라도 연습한 회원 수", example = "61")
                    int practicedWeek,
            @Schema(description = "기준 날짜를 포함한 최근 7일, 날짜 오름차순") List<DailyPractice> daily,
            @Schema(description = "재방문(D1 · D3 · D7), days 오름차순") List<Retention> retention) {}

    public record PersonaCount(
            @Schema(description = "면접관") Persona persona,
            @Schema(description = "total 중 이 면접관과 한 면접 수", example = "350") int count) {}

    public record InterviewMetrics(
            @Schema(description = "답변 1개 이상인 면접 수(분석 중 · 완료 · 실패)", example = "590") int total,
            @Schema(description = "COMPLETED 결과 있음", example = "580") int completed,
            @Schema(description = "ANALYZING 결과 생성 중", example = "4") int analyzing,
            @Schema(description = "FAILED 결과 생성 실패", example = "6") int failed,
            @Schema(description = "ABORTED 답변 없이 끝남(total에는 넣지 않는다)", example = "50") int aborted,
            @Schema(description = "total 중 화상 면접 수", example = "380") int video,
            @Schema(description = "total 중 채팅 면접 수", example = "210") int chat,
            @Schema(
                            description =
                                    "analyzing 중 결과 생성 요청 뒤 최대 대기 시간(ai-job.analysis-timeout)이 지난"
                                            + " 면접 수",
                            example = "1")
                    int stuck,
            @Schema(description = "면접관별 면접 수. 면접관 순서대로 모두 준다") List<PersonaCount> personas) {}

    public record SpeechAverages(
            @Schema(description = "말하기 지표가 있는, 결과가 나온 화상 면접 수", example = "360") int sessions,
            @Schema(description = "1분당 군말 횟수", nullable = true, example = "2.3")
                    Double fillerPerMin,
            @Schema(description = "문장 중간에 길게 멈춘 횟수", nullable = true, example = "2.8")
                    Double longPauseCount,
            @Schema(description = "일반 성인 말 속도와의 차이(%)", nullable = true, example = "6.4")
                    Double speedDeviationPct,
            @Schema(description = "말끝을 흐린 문장 비율(%)", nullable = true, example = "13.1")
                    Double trailingOffRatio,
            @Schema(description = "억양 변화 폭(세미톤)", nullable = true, example = "5.9")
                    Double pitchRangeSt,
            @Schema(description = "면접관을 바라본 시간 비율(%)", nullable = true, example = "68.2")
                    Double gazeRatio) {}

    public record InquiryMetrics(
            @Schema(description = "답변을 기다리는(WAITING) 문의 수", example = "2") int waiting) {}

    public record CriterionAverage(
            @Schema(description = "평가 기준") Criterion criterion,
            @Schema(description = "결과가 있는 면접들의 평균 점수(0~100, 소수 첫째 자리)", example = "71.4")
                    double score) {}

    public record StreakFreezeMetrics(
            @Schema(description = "지급한 유지권 수(지급 전 배포는 빼고)", example = "260") int granted,
            @Schema(description = "사용한 유지권 수", example = "41") int used,
            @Schema(description = "기간이 지나 쓸 수 없게 된 유지권 수", example = "12") int expired) {}

    public record NoticeMetric(
            @Schema(description = "공지 id", example = "3") long id,
            @Schema(description = "공지 제목", example = "10월 점검 안내") String title,
            @Schema(description = "확인(8.9)한 회원 수", example = "64") int readCount) {}

    // 8.16 관리자 일별 메트릭

    @Schema(description = "그날 0시 기록. 날짜로 정해지는 값은 그날 기준, 상태가 바뀌는 값은 기록한 시각 기준(8.15와 같은 정의)")
    public record DailyMetricItem(
            @Schema(description = "날짜(한국 시간)") LocalDate date,
            @Schema(description = "탈퇴하지 않은 전체 회원 수", example = "120") int usersTotal,
            @Schema(description = "그날 가입한 회원 수", example = "3") int usersJoined,
            @Schema(description = "탈퇴한 회원 수", example = "7") int usersWithdrawn,
            @Schema(description = "연습 면접을 한 번 이상 한 회원 수(탈퇴 제외)", example = "84")
                    int usersInterviewed,
            @Schema(description = "그날 연습한 회원 수", example = "18") int practicedUsers,
            @Schema(description = "그날까지 최근 7일 중 하루라도 연습한 회원 수", example = "61") int practicedWeek,
            @Schema(description = "D1 대상 회원 수", example = "124") int d1Eligible,
            @Schema(description = "D1 돌아온 회원 수", example = "46") int d1Returned,
            @Schema(description = "D3 대상 회원 수", example = "118") int d3Eligible,
            @Schema(description = "D3 돌아온 회원 수", example = "31") int d3Returned,
            @Schema(description = "D7 대상 회원 수", example = "103") int d7Eligible,
            @Schema(description = "D7 돌아온 회원 수", example = "22") int d7Returned,
            @Schema(description = "답변 1개 이상인 면접 수(누적)", example = "590") int interviewsTotal,
            @Schema(description = "그중 결과가 나온 면접 수", example = "580") int interviewsCompleted,
            @Schema(description = "그중 결과 생성에 실패한 면접 수", example = "6") int interviewsFailed,
            @Schema(description = "답변 없이 끝난 면접 수(누적)", example = "50") int interviewsAborted,
            @Schema(description = "분석이 멈춘 면접 수", example = "1") int interviewsStuck,
            @Schema(description = "등록된 지원서 수", example = "150") int applications,
            @Schema(description = "답변을 기다리는 문의 수", example = "2") int inquiriesWaiting,
            @Schema(description = "지급한 유지권 수(누적)", example = "260") int freezesGranted,
            @Schema(description = "사용한 유지권 수(누적)", example = "41") int freezesUsed,
            @Schema(description = "기록한 일시") OffsetDateTime recordedAt) {}

    public record DailyMetricsResponse(
            @Schema(description = "조회 시작 날짜(한국 시간)") LocalDate from,
            @Schema(description = "조회 끝 날짜(한국 시간 어제)") LocalDate to,
            @Schema(description = "기간 안의 기록, 날짜 오름차순. 기록이 없는 날은 빠진다")
                    List<DailyMetricItem> content) {}

    public record AdminMetricsResponse(
            @Schema(description = "집계 기준 날짜(한국 시간 오늘)") LocalDate date,
            @Schema(description = "회원") UserMetrics users,
            @Schema(description = "연습") PracticeMetrics practice,
            @Schema(description = "면접") InterviewMetrics interviews,
            @Schema(description = "기준별 평균 점수 4개") List<CriterionAverage> averageScores,
            @Schema(description = "말하기 지표 평균. 소수 첫째 자리, 값이 있는 면접이 없으면 그 지표는 null")
                    SpeechAverages speech,
            @Schema(description = "등록된 지원서 수(탈퇴한 회원 것 포함)", example = "150") int applications,
            @Schema(description = "문의") InquiryMetrics inquiries,
            @Schema(description = "스트릭 유지권") StreakFreezeMetrics streakFreezes,
            @Schema(description = "게시 중인 공지별 확인 수, 최신순. 없으면 빈 배열") List<NoticeMetric> notices) {}
}
