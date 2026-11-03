package com.ssafy.a301.storage.s3;

/** S3에 올라간 파일의 형식과 크기(바이트). 업로드 주소 서명에 넣은 값과 같다 */
public record StoredFile(String contentType, Long size) {}
