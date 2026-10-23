package com.ssafy.a301.admin.mapper;

import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.domain.Notice;
import com.ssafy.a301.admin.domain.StreakFreeze;
import com.ssafy.a301.admin.domain.StreakFreezeGrant;
import com.ssafy.a301.admin.dto.AdminDtos.AdminSummary;
import com.ssafy.a301.admin.dto.AdminDtos.AdminUserItem;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeItem;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeListItem;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeResponse;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeGrantResponse;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeItem;
import com.ssafy.a301.admin.dto.AdminDtos.StreakFreezeUseResponse;
import com.ssafy.a301.user.domain.User;

/** 관리자·공지·유지권 엔티티 → API 응답. 계산값(확인 여부, 받는 회원 수)은 서비스가 구해서 넘긴다. */
public final class AdminMapper {

    private AdminMapper() {}

    public static AdminSummary toSummary(Admin admin) {
        return new AdminSummary(admin.getId(), admin.getLoginId(), admin.getName());
    }

    public static NoticeResponse toNotice(Notice notice) {
        return new NoticeResponse(
                notice.getId(),
                notice.getTitle(),
                notice.getContent(),
                notice.getStartsAt(),
                notice.getEndsAt(),
                notice.getAdmin().getName(),
                notice.getCreatedAt(),
                notice.getUpdatedAt());
    }

    public static NoticeListItem toNoticeListItem(Notice notice) {
        return new NoticeListItem(
                notice.getId(),
                notice.getTitle(),
                notice.getStartsAt(),
                notice.getEndsAt(),
                notice.getCreatedAt());
    }

    public static NoticeItem toNoticeItem(Notice notice, boolean read) {
        return new NoticeItem(
                notice.getId(), notice.getTitle(), notice.getContent(), notice.getStartsAt(), read);
    }

    public static StreakFreezeGrantResponse toGrant(StreakFreezeGrant grant, int targetCount) {
        return new StreakFreezeGrantResponse(
                grant.getId(),
                grant.getTargetType(),
                targetCount,
                grant.getQuantity(),
                grant.getGrantDate(),
                grant.getFillableDate(),
                grant.getReason(),
                grant.getStatus(),
                grant.getAdmin().getName(),
                grant.getCreatedAt(),
                grant.getGrantedAt());
    }

    public static AdminUserItem toUserItem(User user) {
        return new AdminUserItem(
                user.getId(), user.getEmail(), user.getNickname(), user.getCreatedAt());
    }

    /** 8.14 응답. 남은 개수와 메운 뒤의 스트릭은 서비스가 구해서 넘긴다 */
    public static StreakFreezeUseResponse toFreezeUse(
            StreakFreeze freeze, int availableCount, int currentStreak) {
        return new StreakFreezeUseResponse(
                freeze.getFillableDate(), freeze.getId(), availableCount, currentStreak);
    }

    public static StreakFreezeItem toFreezeItem(StreakFreeze freeze) {
        return new StreakFreezeItem(
                freeze.getId(),
                freeze.getFillableDate(),
                freeze.getGrantedAt(),
                freeze.getExpiresAt());
    }
}
