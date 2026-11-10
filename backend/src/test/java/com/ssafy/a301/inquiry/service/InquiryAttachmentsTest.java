package com.ssafy.a301.inquiry.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.ssafy.a301.common.error.ApiException;
import com.ssafy.a301.common.error.ErrorCode;
import com.ssafy.a301.common.error.FieldValidationException;
import com.ssafy.a301.inquiry.dto.InquiryDtos.AttachmentFile;
import com.ssafy.a301.inquiry.repository.InquiryAttachmentRepository;
import com.ssafy.a301.inquiry.service.InquiryAttachments.Claimed;
import com.ssafy.a301.storage.domain.UploadPurpose;
import com.ssafy.a301.storage.repository.UploadKeyStore;
import com.ssafy.a301.storage.s3.PresignedUrl;
import com.ssafy.a301.storage.s3.S3FileStorage;
import com.ssafy.a301.storage.s3.StoredFile;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** 문의 첨부 키: 받는 사람 없이 발급하고, 모두 확인한 뒤에만 한 번 쓴다. */
class InquiryAttachmentsTest {
    private static final UploadPurpose PURPOSE = UploadPurpose.INQUIRY_ATTACHMENT;
    private static final String A = "inquiry/a.png";
    private static final String B = "inquiry/b.jpg";

    private final UploadKeyStore keys = mock(UploadKeyStore.class);
    private final S3FileStorage storage = mock(S3FileStorage.class);
    private final InquiryAttachments attachments =
            new InquiryAttachments(keys, storage, mock(InquiryAttachmentRepository.class));

    @Test
    void uploadUrlsGiveUnguessableKeysInRequestOrder() {
        when(storage.presignUpload(anyString(), anyString(), eq(10L)))
                .thenReturn(new PresignedUrl("https://s3.test/put", OffsetDateTime.now()));

        var urls =
                attachments
                        .uploadUrls(
                                List.of(
                                        new AttachmentFile("image/png", 10L),
                                        new AttachmentFile("image/jpeg", 10L)))
                        .files();

        assertThat(urls).hasSize(2);
        assertThat(urls.get(0).objectKey()).matches("inquiry/[0-9a-f-]{36}\\.png");
        assertThat(urls.get(1).objectKey()).matches("inquiry/[0-9a-f-]{36}\\.jpg");
        verify(keys).issueOnce(urls.get(0).objectKey(), PURPOSE, InquiryAttachments.KEY_TTL);
        verify(keys).issueOnce(urls.get(1).objectKey(), PURPOSE, InquiryAttachments.KEY_TTL);
    }

    @Test
    void claimUsesKeysAndTakesTypeAndSizeFromS3() {
        issued(A, B);
        when(storage.find(A)).thenReturn(Optional.of(new StoredFile("image/png", 100L)));
        when(storage.find(B)).thenReturn(Optional.of(new StoredFile("image/jpeg", 200L)));
        when(keys.use(A, PURPOSE)).thenReturn(true);
        when(keys.use(B, PURPOSE)).thenReturn(true);

        assertThat(attachments.claim(List.of(A, B)))
                .containsExactly(
                        new Claimed(A, "image/png", 100L), new Claimed(B, "image/jpeg", 200L));
    }

    @Test
    void noKeysMeansNoPhotos() {
        assertThat(attachments.claim(null)).isEmpty();
        assertThat(attachments.claim(List.of())).isEmpty();
    }

    @Test
    void notIssuedOrOtherPrefixKeyIsRejectedWithoutUsingAny() {
        issued(A);

        List<String> notIssued = List.of(A, B);
        assertThatThrownBy(() -> attachments.claim(notIssued))
                .isInstanceOf(FieldValidationException.class);
        // 프로필 사진 키 등 다른 경로는 발급 여부도 보지 않는다
        List<String> otherPrefix = List.of("profile/7/a.png");
        assertThatThrownBy(() -> attachments.claim(otherPrefix))
                .isInstanceOf(FieldValidationException.class);
        verify(keys, never()).use(anyString(), eq(PURPOSE));
    }

    @Test
    void sameKeyTwiceIsRejected() {
        issued(A);

        List<String> sameTwice = List.of(A, A);
        assertThatThrownBy(() -> attachments.claim(sameTwice))
                .isInstanceOf(FieldValidationException.class);
        verify(keys, never()).use(anyString(), eq(PURPOSE));
    }

    @Test
    void missingFileKeepsEveryKeyForRetry() {
        issued(A, B);
        when(storage.find(A)).thenReturn(Optional.of(new StoredFile("image/png", 100L)));
        when(storage.find(B)).thenReturn(Optional.empty());

        List<String> objectKeys = List.of(A, B);
        assertThatThrownBy(() -> attachments.claim(objectKeys))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(ErrorCode.FILE_NOT_FOUND));
        verify(keys, never()).use(anyString(), eq(PURPOSE));
    }

    @Test
    void keyUsedByAnotherRequestMeanwhileIsRejected() {
        issued(A);
        when(storage.find(A)).thenReturn(Optional.of(new StoredFile("image/png", 100L)));
        when(keys.use(A, PURPOSE)).thenReturn(false);

        List<String> objectKeys = List.of(A);
        assertThatThrownBy(() -> attachments.claim(objectKeys))
                .isInstanceOf(FieldValidationException.class);
    }

    private void issued(String... objectKeys) {
        for (String key : objectKeys) {
            when(keys.isIssued(key, PURPOSE)).thenReturn(true);
        }
    }
}
