package com.ssafy.a301.inquiry.mapper;

import com.ssafy.a301.inquiry.domain.Inquiry;
import com.ssafy.a301.inquiry.domain.InquiryMessage;
import com.ssafy.a301.inquiry.dto.InquiryDtos;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminInquiryListItem;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminInquiryMessage;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AdminInquiryResponse;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryListItem;
import com.ssafy.a301.inquiry.dto.InquiryDtos.InquiryResponse;
import java.util.List;
import java.util.Map;

/** 문의 엔티티 → 응답. 제목 · 본문은 엔티티를 읽을 때 이미 풀려 있다(EncryptedTextConverter). */
public final class InquiryMapper {
    private InquiryMapper() {}

    public static InquiryDtos.InquiryMessage toMessage(
            InquiryMessage message, List<InquiryDtos.InquiryAttachment> attachments) {
        return new InquiryDtos.InquiryMessage(
                message.getId(),
                message.getAuthorType(),
                message.getContent(),
                message.getCreatedAt(),
                attachments);
    }

    public static InquiryResponse toInquiry(
            Inquiry inquiry,
            List<InquiryMessage> messages,
            Map<Long, List<InquiryDtos.InquiryAttachment>> attachments) {
        return new InquiryResponse(
                inquiry.getId(),
                inquiry.getTitle(),
                inquiry.getStatus(),
                inquiry.getCreatedAt(),
                inquiry.getUpdatedAt(),
                messages.stream()
                        .map(message -> toMessage(message, of(attachments, message)))
                        .toList());
    }

    public static InquiryListItem toListItem(Inquiry inquiry) {
        return new InquiryListItem(
                inquiry.getId(),
                inquiry.getTitle(),
                inquiry.getStatus(),
                inquiry.getCreatedAt(),
                inquiry.getUpdatedAt());
    }

    public static AdminInquiryMessage toAdminMessage(
            InquiryMessage message, List<InquiryDtos.InquiryAttachment> attachments) {
        return new AdminInquiryMessage(
                message.getId(),
                message.getAuthorType(),
                message.getAdmin() == null ? null : message.getAdmin().getName(),
                message.getContent(),
                message.getCreatedAt(),
                attachments);
    }

    /** 회원 문의면 회원 id를 함께 준다(지연 로딩 프록시라도 id만 읽어 쿼리가 나가지 않는다) */
    public static AdminInquiryListItem toAdminListItem(Inquiry inquiry) {
        return new AdminInquiryListItem(
                inquiry.getId(),
                inquiry.getTitle(),
                inquiry.getStatus(),
                inquiry.isGuest() ? null : inquiry.getUser().getId(),
                inquiry.getEmail(),
                inquiry.getCreatedAt(),
                inquiry.getUpdatedAt());
    }

    /** 회원은 fetch join한 user로 닉네임을 준다(InquiryRepository.findWithUser) */
    public static AdminInquiryResponse toAdminInquiry(
            Inquiry inquiry,
            List<InquiryMessage> messages,
            Map<Long, List<InquiryDtos.InquiryAttachment>> attachments) {
        return new AdminInquiryResponse(
                inquiry.getId(),
                inquiry.getTitle(),
                inquiry.getStatus(),
                inquiry.isGuest() ? null : inquiry.getUser().getId(),
                inquiry.isGuest() ? null : inquiry.getUser().getNickname(),
                inquiry.getEmail(),
                inquiry.getCreatedAt(),
                inquiry.getUpdatedAt(),
                messages.stream()
                        .map(message -> toAdminMessage(message, of(attachments, message)))
                        .toList());
    }

    private static List<InquiryDtos.InquiryAttachment> of(
            Map<Long, List<InquiryDtos.InquiryAttachment>> attachments, InquiryMessage message) {
        return attachments.getOrDefault(message.getId(), List.of());
    }
}
