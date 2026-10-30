// 2. 회원 요청. 기준: 웹 Swagger 2.2 ~ 2.10.

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

/**
 * 2.9 PUT /users/me/practice-alarm 본문(연습 알림 켜기).
 * 카카오 인가 요청에 scope=talk_message를 붙여 동의를 받고, 콜백에서 받은 code를 보낸다
 */
export interface PracticeAlarmEnableRequest {
  /** 카카오가 콜백 주소로 넘겨 준 인가 코드. 필수 */
  code: string;
  /** 인가 코드를 받은 콜백 주소. 카카오 로그인(1.6)과 같은 주소. 필수 */
  redirectUri: string;
}

/** 2.10 PATCH /users/me/practice-alarm 본문(연습 알림 시각 변경) */
export interface PracticeAlarmTimeRequest {
  /** 알림 시각(한국 시간, HH:mm). 00:00~23:59, 분 단위 */
  time: string;
}
