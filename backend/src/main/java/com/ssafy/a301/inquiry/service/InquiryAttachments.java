package com.ssafy.a301.inquiry.service;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.inquiry.domain.InquiryAttachment;
import com.ssafy.a301.inquiry.domain.InquiryMessage;
import com.ssafy.a301.inquiry.dto.InquiryDtos;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AttachmentFile;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AttachmentUploadUrl;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AttachmentUploadUrlResponse;
import com.ssafy.a301.inquiry.repository.InquiryAttachmentRepository;
import com.ssafy.a301.storage.domain.UploadPurpose;
import com.ssafy.a301.storage.repository.UploadKeyStore;
import com.ssafy.a301.storage.s3.PresignedUrl;
import com.ssafy.a301.storage.s3.S3FileStorage;
import com.ssafy.a301.storage.s3.StoredFile;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

/** 문의 첨부 사진(9.1 · 9.4 · 9.11). 첫 문의는 묶을 문의번호 · 회원 id가 없어, 추측할 수 없는 키를 한 번만 쓰게 한다. */
@Component
public class InquiryAttachments {
    // 사진을 올린 뒤 글을 쓰는 시간까지 둔다
    static final Duration KEY_TTL = Duration.ofHours(1);
    private static final String PREFIX = "inquiry/";
    private static final Map<String, String> EXTENSIONS =
            Map.of("image/jpeg", "jpg", "image/png", "png");
    private static final String FIELD = "attachmentKeys";

    private final UploadKeyStore uploadKeys;
    private final S3FileStorage storage;
    private final InquiryAttachmentRepository attachments;

    public InquiryAttachments(
            UploadKeyStore uploadKeys,
            S3FileStorage storage,
            InquiryAttachmentRepository attachments) {
        this.uploadKeys = uploadKeys;
        this.storage = storage;
        this.attachments = attachments;
    }

    /** 9.11. 요청한 순서대로 주소를 준다 */
    public AttachmentUploadUrlResponse uploadUrls(List<AttachmentFile> files) {
        List<AttachmentUploadUrl> urls = new ArrayList<>();
        for (AttachmentFile file : files) {
            String objectKey =
                    PREFIX + UUID.randomUUID() + "." + EXTENSIONS.get(file.contentType());
            PresignedUrl upload = storage.presignUpload(objectKey, file.contentType(), file.size());
            uploadKeys.issueOnce(objectKey, UploadPurpose.INQUIRY_ATTACHMENT, KEY_TTL);
            urls.add(new AttachmentUploadUrl(upload.url(), objectKey, upload.expiresAt()));
        }
        return new AttachmentUploadUrlResponse(urls);
    }

    /** 메시지를 저장하기 전에 부른다. 모두 확인한 뒤에 키를 쓰므로, 하나라도 틀리면 어떤 키도 쓰지 않는다. */
    public List<Claimed> claim(List<String> objectKeys) {
        if (objectKeys == null || objectKeys.isEmpty()) {
            return List.of();
        }
        if (new HashSet<>(objectKeys).size() != objectKeys.size()) {
            throw new FieldValidationException(FIELD, "같은 사진을 두 번 붙일 수 없습니다.");
        }
        for (String key : objectKeys) {
            if (!key.startsWith(PREFIX)
                    || !uploadKeys.isIssued(key, UploadPurpose.INQUIRY_ATTACHMENT)) {
                throw notIssued();
            }
        }
        List<Claimed> claimed = new ArrayList<>();
        for (String key : objectKeys) {
            StoredFile file =
                    storage.find(key).orElseThrow(() -> new ApiException(ErrorCode.FILE_NOT_FOUND));
            claimed.add(new Claimed(key, file.contentType(), file.size()));
        }
        // 확인과 쓰기 사이에 같은 키로 먼저 붙였으면 여기서 막힌다
        for (String key : objectKeys) {
            if (!uploadKeys.use(key, UploadPurpose.INQUIRY_ATTACHMENT)) {
                throw notIssued();
            }
        }
        return claimed;
    }

    /** 저장한 메시지에 확인한 사진을 붙인다. 메시지와 같은 트랜잭션에서 부른다 */
    public void attach(InquiryMessage message, List<Claimed> claimed, OffsetDateTime now) {
        for (Claimed file : claimed) {
            attachments.save(
                    new InquiryAttachment(
                            message, file.objectKey(), file.contentType(), file.size(), now));
        }
    }

    /** 메시지 id별 사진(받는 주소 포함). 사진이 없는 메시지는 빠진다 */
    public Map<Long, List<InquiryDtos.InquiryAttachment>> of(List<InquiryMessage> messages) {
        if (messages.isEmpty()) {
            return Map.of();
        }
        return attachments
                .findByMessages(messages.stream().map(InquiryMessage::getId).toList())
                .stream()
                .collect(
                        Collectors.groupingBy(
                                attachment -> attachment.getMessage().getId(),
                                Collectors.mapping(this::toResponse, Collectors.toList())));
    }

    private InquiryDtos.InquiryAttachment toResponse(InquiryAttachment attachment) {
        return new InquiryDtos.InquiryAttachment(
                attachment.getId(), storage.presignDownload(attachment.getObjectKey()));
    }

    private static FieldValidationException notIssued() {
        return new FieldValidationException(FIELD, "발급되지 않았거나 이미 쓴 키입니다.");
    }

    /** 형식 · 크기는 S3에 올라간 값 */
    public record Claimed(String objectKey, String contentType, long size) {}
}
