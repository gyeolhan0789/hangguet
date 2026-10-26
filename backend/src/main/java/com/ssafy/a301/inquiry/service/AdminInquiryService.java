package com.ssafy.a301.inquiry.service;

import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.repository.AdminRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.inquiry.domain.Inquiry;
import com.ssafy.a301.inquiry.domain.InquiryMessage;
import com.ssafy.a301.inquiry.domain.InquiryStatus;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminInquiryListItem;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminInquiryMessage;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminInquiryResponse;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminPasswordChangeRequest;
import com.ssafy.a301.inquiry.mapper.InquiryMapper;
import com.ssafy.a301.inquiry.repository.InquiryMessageRepository;
import com.ssafy.a301.inquiry.repository.InquiryRepository;
import com.ssafy.a301.user.repository.UserRepository;
import com.ssafy.a301.user.service.PasswordChangeService;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PagedModel;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** 9.6 ~ 9.10 관리 페이지 문의. 없는 문의는 404 INQUIRY_NOT_FOUND. 답변 · 종료는 문의 행을 잠그고 한다. */
@Service
public class AdminInquiryService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");
    // 최근 작성 순. 같은 시각이면 id로 순서를 고정한다
    private static final Sort RECENT_FIRST =
            Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));

    private final InquiryRepository inquiries;
    private final InquiryMessageRepository messages;
    private final AdminRepository admins;
    private final UserRepository users;
    private final PasswordChangeService passwordChanges;
    private final TransactionTemplate transactions;

    public AdminInquiryService(
            InquiryRepository inquiries,
            InquiryMessageRepository messages,
            AdminRepository admins,
            UserRepository users,
            PasswordChangeService passwordChanges,
            TransactionTemplate transactions) {
        this.inquiries = inquiries;
        this.messages = messages;
        this.admins = admins;
        this.users = users;
        this.passwordChanges = passwordChanges;
        this.transactions = transactions;
    }

    /** 9.6. status가 없으면 전부. 메시지는 빼고 준다 */
    public PagedModel<AdminInquiryListItem> list(InquiryStatus status, int page, int size) {
        Pageable pageable = PageRequest.of(page, size, RECENT_FIRST);
        return new PagedModel<>(
                (status == null
                                ? inquiries.findAll(pageable)
                                : inquiries.findByStatus(status, pageable))
                        .map(InquiryMapper::toAdminListItem));
    }

    /** 9.7 */
    public AdminInquiryResponse get(long inquiryId) {
        Inquiry inquiry =
                inquiries
                        .findWithUser(inquiryId)
                        .orElseThrow(() -> new ApiException(ErrorCode.INQUIRY_NOT_FOUND));
        return InquiryMapper.toAdminInquiry(inquiry, messages.findThread(inquiryId));
    }

    /** 9.8. 종료한 문의면 409 INQUIRY_CLOSED */
    public AdminInquiryMessage answer(long adminId, long inquiryId, String content) {
        Admin admin =
                admins.findByIdAndDeletedAtIsNull(adminId)
                        .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        InquiryMessage saved =
                transactions.execute(
                        status ->
                                messages.save(
                                        locked(inquiryId)
                                                .addAnswer(
                                                        admin, content, OffsetDateTime.now(KST))));
        return InquiryMapper.toAdminMessage(saved);
    }

    /** 9.9. 이미 종료했어도 그대로 성공 */
    public void close(long inquiryId) {
        transactions.executeWithoutResult(
                status -> locked(inquiryId).close(OffsetDateTime.now(KST)));
    }

    /** 9.10. 없는 회원이면 404 USER_NOT_FOUND, 보낸 문의가 없으면 404 INQUIRY_NOT_FOUND */
    public void changeUserPassword(long adminId, long userId, AdminPasswordChangeRequest request) {
        if (users.findByIdAndDeletedAtIsNull(userId).isEmpty()) {
            throw new ApiException(ErrorCode.USER_NOT_FOUND);
        }
        if (request.inquiryId() != null && !inquiries.existsById(request.inquiryId())) {
            throw new ApiException(ErrorCode.INQUIRY_NOT_FOUND);
        }
        passwordChanges.changeByAdmin(userId, adminId, request.newPassword(), request.inquiryId());
    }

    private Inquiry locked(long inquiryId) {
        return inquiries
                .findForUpdate(inquiryId)
                .orElseThrow(() -> new ApiException(ErrorCode.INQUIRY_NOT_FOUND));
    }
}
