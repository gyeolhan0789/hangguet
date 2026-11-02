package com.ssafy.a301.user.mapper;

import com.ssafy.a301.user.domain.SocialProvider;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.dto.UserDtos.MeResponse;
import com.ssafy.a301.user.dto.UserDtos.NicknameChangeResponse;
import com.ssafy.a301.user.dto.UserDtos.UserSummary;

/** 회원 엔티티 → API 응답. 임시 주소(Presigned GET)와 계산값(스트릭)은 서비스가 구해서 넘긴다. */
public final class UserMapper {

    private UserMapper() {}

    public static UserSummary toSummary(User user, String profileImageUrl) {
        return new UserSummary(user.getId(), user.getEmail(), user.getNickname(), profileImageUrl);
    }

    public static MeResponse toMe(
            User user,
            SocialProvider socialProvider,
            SocialProvider linkedProvider,
            String profileImageUrl,
            int currentStreak) {
        return new MeResponse(
                user.getId(),
                user.getEmail(),
                user.getNickname(),
                socialProvider,
                linkedProvider,
                profileImageUrl,
                user.getCreatedAt(),
                currentStreak);
    }

    public static NicknameChangeResponse toNicknameChange(
            User user,
            SocialProvider socialProvider,
            SocialProvider linkedProvider,
            String profileImageUrl,
            int currentStreak,
            String accessToken,
            long expiresIn) {
        return new NicknameChangeResponse(
                user.getId(),
                user.getEmail(),
                user.getNickname(),
                socialProvider,
                linkedProvider,
                profileImageUrl,
                user.getCreatedAt(),
                currentStreak,
                accessToken,
                expiresIn);
    }
}
