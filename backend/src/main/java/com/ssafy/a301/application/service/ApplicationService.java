package com.ssafy.a301.application.service;

import com.ssafy.a301.application.domain.Application;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationCreateRequest;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationListItem;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationResponse;
import com.ssafy.a301.application.dto.ApplicationDtos.ApplicationUpdateRequest;
import com.ssafy.a301.application.mapper.ApplicationMapper;
import com.ssafy.a301.application.repository.ApplicationRepository;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue;
import com.ssafy.a301.application.repository.CoverLetterCheckQueue.Verdict;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.user.repository.UserRepository;
import java.util.HashSet;
import java.util.Set;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PagedModel;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 4. 지원서. 회원은 토큰의 회원 id로만 찾고, 없거나 남의 지원서는 404다. 면접에 쓴 지원서는 지난 결과·다시보기가 바뀌지 않도록 수정·삭제하지 않는다(409).
 * 자기소개서는 저장하기 전에 AI가 면접 질문을 만들 수 있는 글인지 판단한다(AI 명세 2.1). 면접방에 들어간 뒤 질문 생성이 실패하지 않게 하기 위해서다.
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

    public ApplicationResponse create(long userId, ApplicationCreateRequest request) {
        checkCoverLetter(request.companyName(), request.jobTitle(), request.coverLetter());
        Application saved =
                applications.save(
                        new Application(
                                users.getReferenceById(userId),
                                request.companyName(),
                                request.jobTitle(),
                                request.coverLetter()));
        return ApplicationMapper.toResponse(saved, false);
    }

    public ApplicationResponse get(long userId, long applicationId) {
        Application application =
                applications
                        .findByIdAndUserId(applicationId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.APPLICATION_NOT_FOUND));
        return ApplicationMapper.toResponse(application, applications.isInUse(applicationId));
    }

    /** 자기소개서 본문은 빼고 준다(4.2로 조회). */
    public PagedModel<ApplicationListItem> list(long userId, int page, int size) {
        Page<Application> found =
                applications.findByUserId(userId, PageRequest.of(page, size, RECENT_FIRST));
        Set<Long> inUse =
                found.isEmpty()
                        ? Set.of()
                        : new HashSet<>(
                                applications.findIdsInUse(
                                        found.map(Application::getId).getContent()));
        return new PagedModel<>(
                found.map(a -> ApplicationMapper.toListItem(a, inUse.contains(a.getId()))));
    }

    /** 보낸 필드만 바꾼다. 자기소개서를 보냈을 때만 검증한다. */
    public ApplicationResponse update(
            long userId, long applicationId, ApplicationUpdateRequest request) {
        if (request.coverLetter() != null) {
            // 검증 결과를 기다리는 동안 행을 잠그지 않도록 트랜잭션 밖에서 먼저 확인한다
            Application current =
                    applications
                            .findByIdAndUserId(applicationId, userId)
                            .orElseThrow(() -> new ApiException(ErrorCode.APPLICATION_NOT_FOUND));
            checkCoverLetter(
                    request.companyName() != null
                            ? request.companyName()
                            : current.getCompanyName(),
                    request.jobTitle() != null ? request.jobTitle() : current.getJobTitle(),
                    request.coverLetter());
        }
        Application updated =
                transactions.execute(
                        status -> {
                            Application application = editable(userId, applicationId);
                            application.update(
                                    request.companyName(),
                                    request.jobTitle(),
                                    request.coverLetter());
                            return application;
                        });
        return ApplicationMapper.toResponse(updated, false);
    }

    public void delete(long userId, long applicationId) {
        try {
            transactions.executeWithoutResult(
                    status -> {
                        applications.delete(editable(userId, applicationId));
                        applications.flush();
                    });
        } catch (DataIntegrityViolationException ex) {
            // 확인과 삭제 사이에 이 지원서로 면접이 만들어졌으면 외래키가 막는다
            throw new ApiException(ErrorCode.APPLICATION_IN_USE);
        }
    }

    private void checkCoverLetter(String companyName, String jobTitle, String coverLetter) {
        Verdict verdict = coverLetterChecks.check(companyName, jobTitle, coverLetter);
        if (verdict == Verdict.UNUSABLE) {
            throw new FieldValidationException("coverLetter", UNUSABLE_COVER_LETTER);
        }
        if (verdict == Verdict.UNAVAILABLE) {
            throw new ApiException(ErrorCode.COVER_LETTER_CHECK_UNAVAILABLE);
        }
    }

    // 행을 잠근 뒤 사용 여부를 확인해, 확인 직후 면접에 쓰인 지원서를 고치지 않게 한다.
    private Application editable(long userId, long applicationId) {
        Application application =
                applications
                        .findForUpdate(applicationId, userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.APPLICATION_NOT_FOUND));
        if (applications.isInUse(applicationId)) {
            throw new ApiException(ErrorCode.APPLICATION_IN_USE);
        }
        return application;
    }
}
