package com.ssafy.a301.storage.s3;

import com.ssafy.a301.common.time.KoreaTime;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.S3Exception;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;

/** S3 파일 접근. DB에는 object key만 저장하고 주소는 요청마다 만든다(BE 설계 10장). */
@Component
public class S3FileStorage {

    private final S3Client s3;
    private final S3Presigner presigner;
    private final S3Properties properties;

    public S3FileStorage(S3Client s3, S3Presigner presigner, S3Properties properties) {
        this.s3 = s3;
        this.presigner = presigner;
        this.properties = properties;
    }

    /** 형식과 크기를 서명에 넣어, 발급 때 말한 것과 다른 파일은 S3가 거절하게 한다. */
    public PresignedUrl presignUpload(String objectKey, String contentType, long size) {
        var presigned =
                presigner.presignPutObject(
                        request ->
                                request.signatureDuration(properties.uploadUrlTtl())
                                        .putObjectRequest(
                                                put ->
                                                        put.bucket(properties.bucket())
                                                                .key(objectKey)
                                                                .contentType(contentType)
                                                                .contentLength(size)));
        return new PresignedUrl(
                presigned.url().toString(),
                OffsetDateTime.ofInstant(presigned.expiration(), KoreaTime.ZONE));
    }

    /** 키가 없으면(파일을 등록하지 않았으면) null */
    public String presignDownload(String objectKey) {
        if (objectKey == null) {
            return null;
        }
        return presigner
                .presignGetObject(
                        request ->
                                request.signatureDuration(properties.downloadUrlTtl())
                                        .getObjectRequest(
                                                get ->
                                                        get.bucket(properties.bucket())
                                                                .key(objectKey)))
                .url()
                .toString();
    }

    public boolean exists(String objectKey) {
        return find(objectKey).isPresent();
    }

    /** 올린 파일의 형식 · 크기. 파일이 없으면 빈 값 */
    public Optional<StoredFile> find(String objectKey) {
        try {
            var head = s3.headObject(request -> request.bucket(properties.bucket()).key(objectKey));
            return Optional.of(new StoredFile(head.contentType(), head.contentLength()));
        } catch (S3Exception ex) {
            // 버킷 목록 권한(s3:ListBucket)이 없으면 없는 파일도 404 대신 403이 온다
            if (ex.statusCode() == HttpStatus.NOT_FOUND.value()) {
                return Optional.empty();
            }
            throw ex;
        }
    }

    public void delete(String objectKey) {
        s3.deleteObject(request -> request.bucket(properties.bucket()).key(objectKey));
    }
}
