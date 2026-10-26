package com.ssafy.a301.inquiry.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.inquiry.domain.Inquiry;
import com.ssafy.a301.inquiry.domain.InquiryMessage;
import com.ssafy.a301.inquiry.dto.InquiryDtos;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryCreateRequest;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryListItem;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryResponse;
import com.ssafy.a301.inquiry.mapper.InquiryMapper;
import com.ssafy.a301.inquiry.repository.InquiryMessageRepository;
import com.ssafy.a301.inquiry.repository.InquiryRepository;
import com.ssafy.a301.user.domain.User;
import com.ssafy.a301.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.List;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PagedModel;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 9.1 ~ 9.5 회원 · 비회원 문의. 로그인했으면(userId) 회원 문의, 아니면 비회원 문의다.
 *
 * <p>접근: 회원 문의는 그 회원만, 비회원 문의는 조회 비밀번호(X-Inquiry-Password)가 맞을 때만 볼 수 있다. 없는 문의 · 남의 문의 · 틀린 조회
 * 비밀번호는 모두 같은 응답 코드(404 INQUIRY_NOT_FOUND)로 답한다. 쓰기 · 종료는 접근을 먼저 확인한 뒤(조회 비밀번호 해시 비교는 느려 잠그기 전에 한다)
 * 문의 행을 잠그고 한다.
 */
@Service
public class InquiryService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    // 최근 작성 순. 같은 시각이면 id로 순서를 고정한다
    private static final Sort RECENT_FIRST =
            Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));
    private static final String REQUIRED = "필수 값입니다.";

    private final InquiryRepository inquiries;
    private final InquiryMessageRepository messages;
    private final UserRepository users;
    // 조회 비밀번호는 회원 비밀번호와 같은 방식으로 해시한다
    private final PasswordEncoder passwords;
    private final TransactionTemplate transactions;

    public InquiryService(
            InquiryRepository inquiries,
            InquiryMessageRepository messages,
            UserRepository users,
            PasswordEncoder passwords,
            TransactionTemplate transactions) {
        this.inquiries = inquiries;
        this.messages = messages;
        this.users = users;
        this.passwords = passwords;
        this.transactions = transactions;
    }

    /** 9.1. 회원이면 보낸 email · accessPassword는 쓰지 않는다 */
    public InquiryResponse create(Long userId, InquiryCreateRequest request) {
        OffsetDateTime now = OffsetDateTime.now(KST);
        Inquiry inquiry;
        if (userId != null) {
            User user =
                    users.findByIdAndDeletedAtIsNull(userId)
                            .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
            inquiry = Inquiry.ofMember(user, request.title(), now);
        } else {
            if (request.email() == null || request.email().isBlank()) {
                throw new FieldValidationException("email", REQUIRED);
            }
            if (request.accessPassword() == null) {
                throw new FieldValidationException("accessPassword", REQUIRED);
            }
            inquiry =
                    Inquiry.ofGuest(
                            request.email(),
                            request.title(),
                            passwords.encode(request.accessPassword()),
                            now);
        }
        Inquiry target = inquiry;
        InquiryMessage first =
                transactions.execute(
                        status -> {
                            inquiries.save(target);
                            return messages.save(target.addQuestion(request.content(), now));
                        });
        return InquiryMapper.toInquiry(target, List.of(first));
    }

    /** 9.2. 메시지는 빼고 준다 */
    public PagedModel<InquiryListItem> list(long userId, int page, int size) {
        return new PagedModel<>(
                inquiries
                        .findByUserId(userId, PageRequest.of(page, size, RECENT_FIRST))
                        .map(InquiryMapper::toListItem));
    }

    /** 9.3 */
    public InquiryResponse get(Long userId, long inquiryId, String accessPassword) {
        Inquiry inquiry = readable(inquiryId, userId, accessPassword);
        return InquiryMapper.toInquiry(inquiry, messages.findThread(inquiryId));
    }

    /** 9.4. 종료한 문의면 409 INQUIRY_CLOSED */
    public InquiryDtos.InquiryMessage addQuestion(
            Long userId, long inquiryId, String accessPassword, String content) {
        readable(inquiryId, userId, accessPassword);
        InquiryMessage saved =
                transactions.execute(
                        status ->
                                messages.save(
                                        locked(inquiryId)
                                                .addQuestion(content, OffsetDateTime.now(KST))));
        return InquiryMapper.toMessage(saved);
    }

    /** 9.5. 이미 종료했어도 그대로 성공 */
    public void close(Long userId, long inquiryId, String accessPassword) {
        readable(inquiryId, userId, accessPassword);
        transactions.executeWithoutResult(
                status -> locked(inquiryId).close(OffsetDateTime.now(KST)));
    }

    private Inquiry readable(long inquiryId, Long userId, String accessPassword) {
        return inquiries
                .findById(inquiryId)
                .map(found -> allowed(found, userId, accessPassword))
                .orElseThrow(() -> new ApiException(ErrorCode.INQUIRY_NOT_FOUND));
    }

    // 접근은 readable로 이미 확인했다. 문의는 지우지 않으므로 잠글 때도 있다
    private Inquiry locked(long inquiryId) {
        return inquiries
                .findForUpdate(inquiryId)
                .orElseThrow(() -> new ApiException(ErrorCode.INQUIRY_NOT_FOUND));
    }

    private Inquiry allowed(Inquiry inquiry, Long userId, String accessPassword) {
        boolean ok =
                inquiry.isGuest()
                        ? accessPassword != null
                                && passwords.matches(
                                        accessPassword, inquiry.getAccessPasswordHash())
                        : userId != null && userId.equals(inquiry.getUser().getId());
        if (!ok) {
            throw new ApiException(ErrorCode.INQUIRY_NOT_FOUND);
        }
        return inquiry;
    }
}
