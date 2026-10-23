// 2. 회원 요청. 기준: 웹 Swagger 2.2 ~ 2.7.

/** 2.2 PATCH /users/me 본문 */
export interface NicknameRequest {
  /** 새 닉네임. 필수, 최대 50자, 앞뒤 공백 제거(화면은 빈 값을 막는다) */
  nickname: string;
}

/** 2.3 PATCH /users/me/password 본문 */
export interface PasswordChangeRequest {
  /** 지금 비밀번호. 필수, 최대 64자 */
  currentPassword: string;
  /** 새 비밀번호. 필수, 8~64자, 영문 · 숫자 각 1자 이상 */
  newPassword: string;
}

/** 프로필 사진으로 올릴 수 있는 파일 형식 */
export type ProfileImageContentType = "image/jpeg" | "image/png";

/** 2.4 POST /users/me/profile-image/upload-url 본문 */
export interface ProfileImageUploadUrlRequest {
  /** 올릴 파일 형식(JPG · PNG만) */
  contentType: ProfileImageContentType;
  /** 파일 크기(바이트). 1~5,242,880(5MB) */
  size: number;
}

/** 2.5 PUT /users/me/profile-image 본문 */
export interface ProfileImageRequest {
  /** 2.4에서 받은 objectKey. 필수 */
  objectKey: string;
}

/** 2.7 POST /users/me 본문(회원 탈퇴) */
export interface WithdrawRequest {
  /** 본인 확인용 비밀번호. 필수 */
  password: string;
}
