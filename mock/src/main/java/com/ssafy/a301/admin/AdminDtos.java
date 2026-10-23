package com.ssafy.a301.admin;

import com.ssafy.a301.growth.GrowthDtos;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.List;

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
            @Schema(description = "액세스 토큰 유효 시간(초)", example = "3600") long expiresIn,
            @Schema(description = "로그인한 관리자") AdminSummary admin) {}

    // 8.3 ~ 8.9 공지

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
            @Schema(description = "게시 종료 일시. 보내지 않으면 그대로, null을 보내면 지워 계속 보여 준다", nullable = true)
                    OffsetDateTime endsAt) {}

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

    @Schema(description = "배포 대상. ALL 전체 회원 · USERS 지정 회원")
    public enum GrantTarget {
        ALL,
        USERS
    }

    @Schema(description = "배포 상태. SCHEDULED 지급 전 · GRANTED 지급함")
    public enum GrantStatus {
        SCHEDULED,
        GRANTED
    }

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
            @Schema(description = "받는 회원 수", example = "120") int targetCount,
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
            @Schema(description = "쓸 수 있는 유지권, 만료가 가까운 순. 없으면 빈 배열")
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
            @Schema(description = "기준 날짜(한국 시간)에 가입한 회원 수", example = "3") int joinedToday) {}

    public record DailyPractice(
            @Schema(description = "날짜(한국 시간)") LocalDate date,
            @Schema(description = "그날 연습한 회원 수(연습 기록 기준)", example = "18") int users) {}

    public record PracticeMetrics(
            @Schema(description = "기준 날짜에 연습한 회원 수", example = "18") int practicedToday,
            @Schema(description = "기준 날짜를 포함한 최근 7일, 날짜 오름차순") List<DailyPractice> daily) {}

    public record InterviewMetrics(
            @Schema(description = "답변 1개 이상인 면접 수(분석 중 · 완료 · 실패)", example = "590") int total,
            @Schema(description = "COMPLETED 결과 있음", example = "580") int completed,
            @Schema(description = "ANALYZING 결과 생성 중", example = "4") int analyzing,
            @Schema(description = "FAILED 결과 생성 실패", example = "6") int failed,
            @Schema(description = "ABORTED 답변 없이 끝남(total에는 넣지 않는다)", example = "50") int aborted,
            @Schema(description = "total 중 화상 면접 수", example = "380") int video,
            @Schema(description = "total 중 채팅 면접 수", example = "210") int chat) {}

    public record CriterionAverage(
            @Schema(description = "평가 기준") GrowthDtos.Criterion criterion,
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

    public record AdminMetricsResponse(
            @Schema(description = "집계 기준 날짜(한국 시간 오늘)") LocalDate date,
            @Schema(description = "회원") UserMetrics users,
            @Schema(description = "연습") PracticeMetrics practice,
            @Schema(description = "면접") InterviewMetrics interviews,
            @Schema(description = "기준별 평균 점수 4개") List<CriterionAverage> averageScores,
            @Schema(description = "스트릭 유지권") StreakFreezeMetrics streakFreezes,
            @Schema(description = "게시 중인 공지별 확인 수, 최신순. 없으면 빈 배열") List<NoticeMetric> notices) {}
}
