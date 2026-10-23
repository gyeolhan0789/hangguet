package com.ssafy.a301.admin.service;

import com.ssafy.a301.admin.domain.Notice;
import com.ssafy.a301.admin.dto.AdminDtos.NoticesResponse;
import com.ssafy.a301.admin.mapper.AdminMapper;
import com.ssafy.a301.admin.repository.NoticeReadRepository;
import com.ssafy.a301.admin.repository.NoticeRepository;
import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** 8.8 · 8.9 회원이 보는 공지. 게시 중인 공지를 최신순으로 주고, 회원마다 확인 여부를 함께 준다. */
@Service
public class NoticeService {
    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private final NoticeRepository notices;
    private final NoticeReadRepository noticeReads;
    private final TransactionTemplate transactions;

    public NoticeService(
            NoticeRepository notices,
            NoticeReadRepository noticeReads,
            TransactionTemplate transactions) {
        this.notices = notices;
        this.noticeReads = noticeReads;
        this.transactions = transactions;
    }

    public NoticesResponse notices(long userId) {
        List<Notice> visible = notices.findVisible(OffsetDateTime.now(KST));
        Set<Long> read =
                visible.isEmpty()
                        ? Set.of()
                        : new HashSet<>(
                                noticeReads.findReadNoticeIds(
                                        userId, visible.stream().map(Notice::getId).toList()));
        return new NoticesResponse(
                visible.stream()
                        .map(n -> AdminMapper.toNoticeItem(n, read.contains(n.getId())))
                        .toList());
    }

    /** 이미 확인했어도 그대로 성공. 없거나 삭제한 공지는 404 */
    public void read(long userId, long noticeId) {
        transactions.executeWithoutResult(
                status -> {
                    notices.findByIdAndDeletedAtIsNull(noticeId)
                            .orElseThrow(() -> new ApiException(ErrorCode.NOTICE_NOT_FOUND));
                    noticeReads.insertIfAbsent(noticeId, userId);
                });
    }
}
