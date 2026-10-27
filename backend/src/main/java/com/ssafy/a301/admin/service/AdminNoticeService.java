package com.ssafy.a301.admin.service;

import com.ssafy.a301.admin.domain.Admin;
import com.ssafy.a301.admin.domain.Notice;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeCreateRequest;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeListItem;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeResponse;
import com.ssafy.a301.admin.dto.AdminDtos.NoticeUpdateRequest;
import com.ssafy.a301.admin.mapper.AdminMapper;
import com.ssafy.a301.admin.repository.AdminRepository;
import com.ssafy.a301.admin.repository.NoticeRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.time.KoreaTime;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.web.PagedModel;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 8.3 ~ 8.7 관리 페이지 공지. 삭제는 행을 남기고 deleted_at만 채운다(목록 · 사용자 화면에서 빠짐). 없거나 삭제한 공지는 404
 * NOTICE_NOT_FOUND. 수정 · 삭제는 공지 행을 잠그고 한다. 게시 기간은 필수 값만 검사한다(시작 · 종료 관계는 보지 않음).
 */
@Service
public class AdminNoticeService {
    // 최근 작성 순. 같은 시각이면 id로 순서를 고정한다
    private static final Sort RECENT_FIRST =
            Sort.by(Sort.Order.desc("createdAt"), Sort.Order.desc("id"));

    private final NoticeRepository notices;
    private final AdminRepository admins;
    private final TransactionTemplate transactions;

    public AdminNoticeService(
            NoticeRepository notices, AdminRepository admins, TransactionTemplate transactions) {
        this.notices = notices;
        this.admins = admins;
        this.transactions = transactions;
    }

    /** 본문은 빼고 준다(8.5로 조회). */
    public PagedModel<NoticeListItem> list(int page, int size) {
        return new PagedModel<>(
                notices.findByDeletedAtIsNull(PageRequest.of(page, size, RECENT_FIRST))
                        .map(AdminMapper::toNoticeListItem));
    }

    public NoticeResponse create(long adminId, NoticeCreateRequest request) {
        // 응답에 관리자 이름을 쓰므로 프록시가 아닌 엔티티로 읽는다
        Admin admin =
                admins.findByIdAndDeletedAtIsNull(adminId)
                        .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        Notice saved =
                notices.saveAndFlush(
                        new Notice(
                                admin,
                                request.title(),
                                request.content(),
                                request.startsAt(),
                                request.endsAt()));
        return AdminMapper.toNotice(saved);
    }

    public NoticeResponse get(long noticeId) {
        return AdminMapper.toNotice(
                notices.findWithAdmin(noticeId)
                        .orElseThrow(() -> new ApiException(ErrorCode.NOTICE_NOT_FOUND)));
    }

    /** 보낸 필드만 바꾼다. endsAt은 null을 보내면 지운다. */
    public NoticeResponse update(long noticeId, NoticeUpdateRequest request) {
        Notice updated =
                transactions.execute(
                        status -> {
                            Notice notice = editable(noticeId);
                            notice.update(request.title(), request.content(), request.startsAt());
                            if (request.endsAt() != null) {
                                notice.changeEndsAt(request.endsAt().orElse(null));
                            }
                            return notice;
                        });
        return AdminMapper.toNotice(updated);
    }

    public void delete(long noticeId) {
        transactions.executeWithoutResult(status -> editable(noticeId).delete(KoreaTime.now()));
    }

    private Notice editable(long noticeId) {
        return notices.findForUpdate(noticeId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOTICE_NOT_FOUND));
    }
}
