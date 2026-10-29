package com.ssafy.a301.application.service;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationCreateRequest;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationListItem;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationResponse;
import com.ssafy.a301.application.dto.ApplicationDtos.CoverLetterItemRequest;
import com.ssafy.a301.application.mapper.ApplicationMapper;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue.Verdict;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.common.time.KoreaTime;
import com.ssafy.a301.user.repository.UserRepository;
import java.util.List;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PagedModel;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 4. 지원서. 회원은 토큰의 회원 id로만 찾고, 없거나 남의 지원서 · 지운 지원서는 404다. 지원서는 수정하지 않는다. 지우면 deleted_at만 채워, 그 지원서로
 * 본 면접 기록 · 결과 · 다시보기는 그대로 남긴다. 자기소개서는 저장하기 전에 AI가 면접 질문을 만들 수 있는 글인지 판단한다(AI 명세 2.1). 면접방에 들어간 뒤
 * 질문 생성이 실패하지 않게 하기 위해서다.
 */
@Service
public class ApplicationService {
    // 최근 작성 순. 같은 시각이면 id로 순서를 고정해 페이지가 흔들리지 않게 한다
    private static final Sort RECENT_FIRST =
            Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
    static final String UNUSABLE_COVER_LETTER =
            "면접 질문을 만들기 어려운 자기소개서예요. 지원 동기나 경험을 조금 더 구체적으로 적어 주세요.";

    private final ApplicationRepository applications;
    private final UserRepository users;
    private final TransactionTemplate transactions;
    private final CoverLetterCheckQueue coverLetterChecks;

    public ApplicationService(
            ApplicationRepository applications,
            UserRepository users,
            TransactionTemplate transactions,
            CoverLetterCheckQueue coverLetterChecks) {
        this.applications = applications;
        this.users = users;
        this.transactions = transactions;
        this.coverLetterChecks = coverLetterChecks;
    }

    /** 검증 결과를 기다리는 동안 트랜잭션을 열어 두지 않도록, 먼저 판단받고 지원서와 문항을 함께 저장한다. */
    public ApplicationResponse create(long userId, ApplicationCreateRequest request) {
        checkCoverLetter(request.companyName(), request.jobTitle(), request.coverLetterItems());
        return transactions.execute(
                status -> {
                    Application application =
                            new Application(
                                    users.getReferenceById(userId),
                                    request.companyName(),
                                    request.jobTitle());
                    for (CoverLetterItemRequest item : request.coverLetterItems()) {
                        application.addCoverLetterItem(item.question(), item.answer());
                    }
                    return ApplicationMapper.toResponse(applications.saveAndFlush(application));
                });
    }

    @Transactional(readOnly = true)
    public ApplicationResponse get(long userId, long applicationId) {
        return ApplicationMapper.toResponse(
                applications
                        .findByIdAndUserIdAndDeletedAtIsNull(applicationId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.APPLICATION_NOT_FOUND)));
    }

    /** 자기소개서 문항은 빼고 준다(4.2로 조회). */
    public PagedModel<ApplicationListItem> list(long userId, int page, int size) {
        PageRequest pageable = PageRequest.of(page, size, RECENT_FIRST);
        // JPA는 int 범위의 offset만 지원한다. 그 밖의 페이지는 빈 목록과 전체 건수를 준다(4.6과 같음).
        Page<Application> found =
                pageable.getOffset() > Integer.MAX_VALUE
                        ? new PageImpl<>(
                                List.of(),
                                pageable,
                                applications
                                        .findByUserIdAndDeletedAtIsNull(
                                                userId, PageRequest.of(0, 1))
                                        .getTotalElements())
                        : applications.findByUserIdAndDeletedAtIsNull(userId, pageable);
        return new PagedModel<>(found.map(ApplicationMapper::toListItem));
    }

    /** 면접에 쓴 지원서도 지운다. 행을 잠가, 지우는 동안 같은 지원서로 면접(5.1)을 만들지 않게 한다. */
    public void delete(long userId, long applicationId) {
        transactions.executeWithoutResult(
                status ->
                        applications
                                .findForUpdate(applicationId, userId)
                                .orElseThrow(
                                        () -> new ApiException(ErrorCode.APPLICATION_NOT_FOUND))
                                .delete(KoreaTime.now()));
    }

    private void checkCoverLetter(
            String companyName, String jobTitle, List<CoverLetterItemRequest> coverLetterItems) {
        List<CoverLetterCheckQueue.Item> items =
                coverLetterItems.stream()
                        .map(item -> new CoverLetterCheckQueue.Item(item.question(), item.answer()))
                        .toList();
        Verdict verdict = coverLetterChecks.check(companyName, jobTitle, items);
        if (verdict == Verdict.UNUSABLE) {
            throw new FieldValidationException("coverLetterItems", UNUSABLE_COVER_LETTER);
        }
        if (verdict == Verdict.UNAVAILABLE) {
            throw new ApiException(ErrorCode.COVER_LETTER_CHECK_UNAVAILABLE);
        }
    }
}
