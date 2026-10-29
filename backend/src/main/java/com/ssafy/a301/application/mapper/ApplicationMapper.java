package com.ssafy.a301.application.mapper;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationListItem;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationResponse;
import com.ssafy.a301.application.dto.ApplicationDtos.CoverLetterItem;

/** 지원서 엔티티 → API 응답 */
public final class ApplicationMapper {

    private ApplicationMapper() {}

    public static ApplicationResponse toResponse(Application application) {
        return new ApplicationResponse(
                application.getId(),
                application.getCompanyName(),
                application.getJobTitle(),
                application.getCoverLetterItems().stream()
                        .map(
                                item ->
                                        new CoverLetterItem(
                                                item.getItemOrder(),
                                                item.getQuestion(),
                                                item.getAnswer()))
                        .toList(),
                application.getCreatedAt());
    }

    public static ApplicationListItem toListItem(Application application) {
        return new ApplicationListItem(
                application.getId(),
                application.getCompanyName(),
                application.getJobTitle(),
                application.getCreatedAt());
    }
}
