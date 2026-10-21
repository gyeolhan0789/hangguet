package com.ssafy.a301.storage.s3;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.function.Consumer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

class S3FileStorageTest {
    private final S3Client s3 = mock(S3Client.class);
    // 서명은 네트워크 없이 로컬에서 만들어지므로 실제 Presigner를 쓴다
    private final S3Presigner presigner =
            S3Presigner.builder()
                    .region(Region.AP_NORTHEAST_2)
                    .credentialsProvider(
                            StaticCredentialsProvider.create(
                                    AwsBasicCredentials.create("test-key", "test-secret")))
                    .build();
    private final S3FileStorage storage =
            new S3FileStorage(
                    s3,
                    presigner,
                    new S3Properties(
                            "a301-bucket",
                            "ap-northeast-2",
                            Duration.ofMinutes(10),
                            Duration.ofHours(1)));

    @AfterEach
    void tearDown() {
        presigner.close();
    }

    @Test
    void uploadUrlSignsTypeAndSize() {
        var upload = storage.presignUpload("profile/7/a.png", "image/png", 1024);

        assertThat(upload.url())
                .contains("a301-bucket")
                .contains("profile/7/a.png")
                .contains("X-Amz-Expires=600")
                .contains("content-length")
                .contains("content-type");
        assertThat(upload.expiresAt().getOffset().getId()).isEqualTo("+09:00");
    }

    @Test
    void downloadUrlUsesDownloadLifetime() {
        assertThat(storage.presignDownload("profile/7/a.png"))
                .contains("profile/7/a.png")
                .contains("X-Amz-Expires=3600");
    }

    @Test
    void missingKeyHasNoDownloadUrl() {
        assertThat(storage.presignDownload(null)).isNull();
    }

    @Test
    @SuppressWarnings("unchecked")
    void existsReflectsHeadObject() {
        when(s3.headObject(any(Consumer.class))).thenReturn(HeadObjectResponse.builder().build());
        assertThat(storage.exists("profile/7/a.png")).isTrue();

        when(s3.headObject(any(Consumer.class)))
                .thenThrow(NoSuchKeyException.builder().statusCode(404).build());
        assertThat(storage.exists("profile/7/a.png")).isFalse();
    }

    @Test
    @SuppressWarnings("unchecked")
    void accessDeniedIsNotTreatedAsMissingFile() {
        when(s3.headObject(any(Consumer.class)))
                .thenThrow(S3Exception.builder().statusCode(403).build());

        assertThatThrownBy(() -> storage.exists("profile/7/a.png")).isInstanceOf(S3Exception.class);
    }
}
