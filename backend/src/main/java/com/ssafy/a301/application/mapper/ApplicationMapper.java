package com.ssafy.a301.application.mapper;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationListItem;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationResponse;

/** 지원서 엔티티 → API 응답. inUse(면접에 쓴 적 있는지)는 서비스가 조회해서 넘긴다. */
public final class ApplicationMapper {

    private ApplicationMapper() {}

    public static ApplicationResponse toResponse(Application application, boolean inUse) {
        return new ApplicationResponse(
                application.getId(),
                application.getCompanyName(),
                application.getJobTitle(),
                application.getCoverLetter(),
                application.getCreatedAt(),
                inUse);
    }

    public static ApplicationListItem toListItem(Application application, boolean inUse) {
        return new ApplicationListItem(
                application.getId(),
                application.getCompanyName(),
                application.getJobTitle(),
                application.getCreatedAt(),
                inUse);
    }
}
