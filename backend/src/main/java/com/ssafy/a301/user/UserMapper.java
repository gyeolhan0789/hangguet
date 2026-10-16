package com.ssafy.a301.user;

import com.ssafy.a301.user.UserDtos.MeResponse;
import com.ssafy.a301.user.UserDtos.UserSummary;
import com.ssafy.a301.user.domain.User;

/** 회원 엔티티 → API 응답. 임시 주소(Presigned GET)와 계산값(스트릭)은 서비스가 구해서 넘긴다. */
public final class UserMapper {

    private UserMapper() {}

    public static UserSummary toSummary(User user, String profileImageUrl) {
        return new UserSummary(user.getId(), user.getEmail(), user.getNickname(), profileImageUrl);
    }

    public static MeResponse toMe(User user, String profileImageUrl, int currentStreak) {
        return new MeResponse(
                user.getId(),
                user.getEmail(),
                user.getNickname(),
                profileImageUrl,
                user.getCreatedAt(),
                currentStreak);
    }
}
