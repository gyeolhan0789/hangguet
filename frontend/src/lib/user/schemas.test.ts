// @vitest-environment node
// 기준: 웹 Swagger 2.2 NicknameRequest(최대 50자 · 앞뒤 공백 제거) · 2.3 PasswordChangeRequest(currentPassword 최대 64자,
// newPassword 8~64자 · 영문 · 숫자) · 2.4 ProfileImageUploadUrlRequest(JPG · PNG, 1~5,242,880바이트) · 2.5 objectKey
// · 2.7 WithdrawRequest(최대 64자) · 2.10 PracticeAlarmTimeRequest(HH:mm)
import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  nicknameSchema,
  objectKeySchema,
  passwordChangeSchema,
  practiceAlarmTimeSchema,
  profileImageUploadSchema,
  withdrawSchema,
} from "./schemas";

const NEW_PASSWORD_RULE = "8~64자, 영문과 숫자를 모두 포함해야 합니다.";
const VALID_NEW = "newpass123";

/** 검증 실패의 첫 문구(통과하면 undefined) */
function firstError(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? undefined : result.error.issues[0].message;
}

describe("nicknameSchema · 닉네임 규칙", () => {
  describe("정상 처리", () => {
    it("앞뒤 공백을 지운 닉네임으로 바꾼다", () => {
      expect(nicknameSchema.parse({ nickname: "  면접왕 " })).toEqual({ nickname: "면접왕" });
    });
  });

  describe("입력 검증", () => {
    it("공백뿐이면 '필수 값입니다.'로 막는다", () => {
      expect(firstError(nicknameSchema, { nickname: "   " })).toBe("필수 값입니다.");
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "1자", nickname: "가" },
      { label: "50자", nickname: "가".repeat(50) },
    ])("닉네임이 '$label'이면 받는다", ({ nickname }) => {
      expect(nicknameSchema.safeParse({ nickname }).success).toBe(true);
    });

    it("닉네임이 51자면 '1~50자입니다.'로 막는다", () => {
      expect(firstError(nicknameSchema, { nickname: "가".repeat(51) })).toBe("1~50자입니다.");
    });
  });
});

describe("passwordChangeSchema · 비밀번호 변경 규칙", () => {
  describe("입력 검증", () => {
    it("새 비밀번호가 영문 · 숫자 규칙에 어긋나면 규칙 문구로 막는다", () => {
      expect(
        firstError(passwordChangeSchema, {
          currentPassword: "password123",
          newPassword: "abcdefgh",
        }),
      ).toBe(NEW_PASSWORD_RULE);
    });

    it("지금 비밀번호가 공백뿐이면 '필수 값입니다.'로 막는다", () => {
      expect(
        firstError(passwordChangeSchema, { currentPassword: "   ", newPassword: VALID_NEW }),
      ).toBe("필수 값입니다.");
    });
  });

  describe("경계값", () => {
    it("새 비밀번호가 64자면 받는다", () => {
      const newPassword = `a1${"b".repeat(62)}`;

      expect(
        passwordChangeSchema.safeParse({ currentPassword: "password123", newPassword }).success,
      ).toBe(true);
    });

    it("새 비밀번호가 65자면 규칙 문구로 막는다", () => {
      const newPassword = `a1${"b".repeat(63)}`;

      expect(
        firstError(passwordChangeSchema, { currentPassword: "password123", newPassword }),
      ).toBe(NEW_PASSWORD_RULE);
    });

    it("지금 비밀번호가 64자면 받는다", () => {
      expect(
        passwordChangeSchema.safeParse({ currentPassword: "a".repeat(64), newPassword: VALID_NEW })
          .success,
      ).toBe(true);
    });

    it("지금 비밀번호가 65자면 '최대 64자입니다.'로 막는다", () => {
      expect(
        firstError(passwordChangeSchema, {
          currentPassword: "a".repeat(65),
          newPassword: VALID_NEW,
        }),
      ).toBe("최대 64자입니다.");
    });
  });
});

describe("practiceAlarmTimeSchema · 알림 시각 규칙", () => {
  describe("경계값", () => {
    it.each([{ time: "00:00" }, { time: "23:59" }, { time: "09:05" }])(
      "'$time'이면 받는다",
      ({ time }) => {
        expect(practiceAlarmTimeSchema.safeParse({ time }).success).toBe(true);
      },
    );

    it.each([
      { label: "24:00", time: "24:00" },
      { label: "23:60", time: "23:60" },
      { label: "9:00", time: "9:00" },
      { label: "빈 값", time: "" },
      { label: "뒤 공백", time: "09:00 " },
    ])("'$label'이면 형식 문구로 막는다", ({ time }) => {
      expect(firstError(practiceAlarmTimeSchema, { time })).toBe("HH:mm 형식(00:00~23:59)입니다.");
    });
  });
});

describe("withdrawSchema · 탈퇴 비밀번호 규칙", () => {
  describe("입력 검증", () => {
    it("공백뿐이면 '필수 값입니다.'로 막는다", () => {
      expect(firstError(withdrawSchema, { password: "   " })).toBe("필수 값입니다.");
    });
  });

  describe("경계값", () => {
    it("비밀번호가 64자면 받는다", () => {
      expect(withdrawSchema.safeParse({ password: "a".repeat(64) }).success).toBe(true);
    });

    it("비밀번호가 65자면 '최대 64자입니다.'로 막는다", () => {
      expect(firstError(withdrawSchema, { password: "a".repeat(65) })).toBe("최대 64자입니다.");
    });
  });
});

describe("profileImageUploadSchema · 프로필 사진 규칙", () => {
  describe("입력 검증", () => {
    it("GIF면 'JPG·PNG만 올릴 수 있습니다.'로 막는다", () => {
      expect(firstError(profileImageUploadSchema, { contentType: "image/gif", size: 1024 })).toBe(
        "JPG·PNG만 올릴 수 있습니다.",
      );
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "1바이트", size: 1 },
      { label: "5,242,880바이트", size: 5_242_880 },
    ])("크기가 '$label'이면 받는다", ({ size }) => {
      expect(profileImageUploadSchema.safeParse({ contentType: "image/png", size }).success).toBe(
        true,
      );
    });

    it.each([
      { label: "0바이트", size: 0, message: "1바이트 이상입니다." },
      { label: "5,242,881바이트", size: 5_242_881, message: "5MB 이하만 올릴 수 있습니다." },
    ])("크기가 '$label'이면 그 크기 문구로 막는다", ({ size, message }) => {
      expect(firstError(profileImageUploadSchema, { contentType: "image/png", size })).toBe(
        message,
      );
    });
  });
});

describe("objectKeySchema · 올린 파일 키 규칙", () => {
  describe("입력 검증", () => {
    it("공백뿐이면 '필수 값입니다.'로 막는다", () => {
      expect(firstError(objectKeySchema, "   ")).toBe("필수 값입니다.");
    });
  });
});
