// @vitest-environment node
// 기준: Swagger 9.1 InquiryCreateRequest(title 1~100자 · content 필수 · email 최대 255자 · accessPassword 4~20자)
// · 9.11 AttachmentFile(JPG · PNG, 1바이트~5MB, 1~5장) · attachmentKeys 최대 5개 · 기획 메모 I01 · I01-B · I04
import { describe, expect, it } from "vitest";

import {
  attachmentKeysSchema,
  guestInquiryFormSchema,
  guestInquirySchema,
  guestLookupSchema,
  inquiryPhotoSchema,
  inquiryPhotosSchema,
  inquirySchema,
  PHOTO_COUNT,
} from "./schemas";

// 예시 데이터: Swagger 9.1 요청 예시 값
const INQUIRY = { title: "비밀번호를 잊어버렸어요", content: "비밀번호를 바꿔 주세요." };
const GUEST = { email: "a@ssafy.com", accessPassword: "1234", ...INQUIRY };
const PNG = { contentType: "image/png", size: 1024 };

/** 검사 결과의 첫 문구(칸을 주면 그 칸의 첫 문구). 통과하면 undefined */
function firstMessage(
  result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  field?: string,
) {
  const issues = result.error?.issues ?? [];
  return (field ? issues.filter(({ path }) => path[0] === field) : issues)[0]?.message;
}

describe("inquirySchema · 문의 규칙(회원)", () => {
  describe("입력 검증", () => {
    it.each([
      { label: "제목", field: "title" },
      { label: "내용", field: "content" },
    ])("'$label'이 공백뿐이면 '필수 값입니다.'로 막는다", ({ field }) => {
      const result = inquirySchema.safeParse({ ...INQUIRY, [field]: "   " });

      expect(firstMessage(result, field)).toBe("필수 값입니다.");
    });
  });

  describe("경계값", () => {
    it("제목이 100자면 받는다", () => {
      expect(inquirySchema.safeParse({ ...INQUIRY, title: "가".repeat(100) }).success).toBe(true);
    });

    it("제목이 101자면 '최대 100자입니다.'로 막는다", () => {
      const result = inquirySchema.safeParse({ ...INQUIRY, title: "가".repeat(101) });

      expect(firstMessage(result, "title")).toBe("최대 100자입니다.");
    });

    it("내용이 2,000자면 받는다", () => {
      expect(inquirySchema.safeParse({ ...INQUIRY, content: "가".repeat(2000) }).success).toBe(
        true,
      );
    });

    it("내용이 2,001자면 '최대 2,000자입니다.'로 막는다", () => {
      const result = inquirySchema.safeParse({ ...INQUIRY, content: "가".repeat(2001) });

      expect(firstMessage(result, "content")).toBe("최대 2,000자입니다.");
    });
  });
});

describe("guestInquirySchema · 문의 규칙(비회원)", () => {
  describe("입력 검증", () => {
    it("이메일이 비면 '필수 값입니다.'로 막는다", () => {
      const result = guestInquirySchema.safeParse({ ...GUEST, email: "" });

      expect(firstMessage(result, "email")).toBe("필수 값입니다.");
    });

    it("조회 비밀번호가 비면 '필수 값입니다.'로 막는다", () => {
      const result = guestInquirySchema.safeParse({ ...GUEST, accessPassword: "" });

      expect(firstMessage(result, "accessPassword")).toBe("필수 값입니다.");
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "4자", accessPassword: "1234" },
      { label: "20자", accessPassword: "a".repeat(20) },
    ])("조회 비밀번호가 '$label'이면 받는다", ({ accessPassword }) => {
      expect(guestInquirySchema.safeParse({ ...GUEST, accessPassword }).success).toBe(true);
    });

    it.each([
      { label: "3자", accessPassword: "123" },
      { label: "21자", accessPassword: "a".repeat(21) },
    ])("조회 비밀번호가 '$label'이면 '4~20자입니다.'로 막는다", ({ accessPassword }) => {
      const result = guestInquirySchema.safeParse({ ...GUEST, accessPassword });

      expect(firstMessage(result, "accessPassword")).toBe("4~20자입니다.");
    });

    it("이메일이 255자면 받는다", () => {
      // 243 + "@example.com"(12) = 255자
      const email = `${"a".repeat(243)}@example.com`;

      expect(guestInquirySchema.safeParse({ ...GUEST, email }).success).toBe(true);
    });

    it("이메일이 256자면 '최대 255자입니다.'로 막는다", () => {
      // 244 + "@example.com"(12) = 256자
      const email = `${"a".repeat(244)}@example.com`;
      const result = guestInquirySchema.safeParse({ ...GUEST, email });

      expect(firstMessage(result, "email")).toBe("최대 255자입니다.");
    });
  });
});

describe("guestInquiryFormSchema · 비회원 문의 폼 규칙", () => {
  describe("입력 검증", () => {
    it("개인정보 수집 · 이용에 동의하지 않으면 동의 문구로 막는다", () => {
      const result = guestInquiryFormSchema.safeParse({ ...GUEST, agreed: false });

      expect(firstMessage(result, "agreed")).toBe("개인정보 수집 · 이용에 동의해 주세요.");
    });
  });
});

describe("guestLookupSchema · 비회원 문의 확인 규칙", () => {
  describe("입력 검증", () => {
    it("문의번호가 공백뿐이면 '필수 값입니다.'로 막는다", () => {
      const result = guestLookupSchema.safeParse({ inquiryId: "  ", accessPassword: "1234" });

      expect(firstMessage(result, "inquiryId")).toBe("필수 값입니다.");
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "1", inquiryId: "1" },
      { label: "16자리", inquiryId: "1".repeat(16) },
    ])("문의번호가 '$label'이면 받는다", ({ inquiryId }) => {
      expect(guestLookupSchema.safeParse({ inquiryId, accessPassword: "1234" }).success).toBe(true);
    });

    it.each([
      { label: "0", inquiryId: "0" },
      { label: "07", inquiryId: "07" },
      { label: "17자리", inquiryId: "1".repeat(17) },
    ])("문의번호가 '$label'이면 '문의를 찾을 수 없어요.'로 막는다", ({ inquiryId }) => {
      const result = guestLookupSchema.safeParse({ inquiryId, accessPassword: "1234" });

      expect(firstMessage(result, "inquiryId")).toBe("문의를 찾을 수 없어요.");
    });
  });
});

describe("inquiryPhotoSchema · 문의 사진 하나 규칙", () => {
  describe("입력 검증", () => {
    it("GIF면 'JPG·PNG만 올릴 수 있습니다.'로 막는다", () => {
      const result = inquiryPhotoSchema.safeParse({ ...PNG, contentType: "image/gif" });

      expect(firstMessage(result)).toBe("JPG·PNG만 올릴 수 있습니다.");
    });
  });

  describe("경계값", () => {
    it.each([
      { label: "1바이트", size: 1 },
      { label: "5,242,880바이트", size: 5_242_880 },
    ])("크기가 '$label'이면 받는다", ({ size }) => {
      expect(inquiryPhotoSchema.safeParse({ ...PNG, size }).success).toBe(true);
    });

    it.each([
      { label: "0바이트", size: 0, message: "1바이트 이상입니다." },
      { label: "5,242,881바이트", size: 5_242_881, message: "5MB 이하만 올릴 수 있습니다." },
    ])("크기가 '$label'이면 그 크기 문구로 막는다", ({ size, message }) => {
      expect(firstMessage(inquiryPhotoSchema.safeParse({ ...PNG, size }))).toBe(message);
    });
  });
});

describe("inquiryPhotosSchema · 한 번에 올릴 사진 규칙", () => {
  describe("경계값", () => {
    it("사진이 5장이면 받는다", () => {
      expect(inquiryPhotosSchema.safeParse(Array.from({ length: 5 }, () => PNG)).success).toBe(
        true,
      );
    });

    it("사진이 6장이면 장수 문구로 막는다", () => {
      const result = inquiryPhotosSchema.safeParse(Array.from({ length: 6 }, () => PNG));

      expect(firstMessage(result)).toBe(PHOTO_COUNT);
    });

    it("사진이 0장이면 '필수 값입니다.'로 막는다", () => {
      expect(firstMessage(inquiryPhotosSchema.safeParse([]))).toBe("필수 값입니다.");
    });
  });
});

describe("attachmentKeysSchema · 보낼 사진 키 규칙", () => {
  describe("입력 검증", () => {
    it("빈 사진 키가 있으면 막는다", () => {
      expect(attachmentKeysSchema.safeParse(["inquiry/a.png", ""]).success).toBe(false);
    });
  });

  describe("경계값", () => {
    it("사진 키가 5개면 받는다", () => {
      const keys = Array.from({ length: 5 }, (_, index) => `inquiry/${index}.png`);

      expect(attachmentKeysSchema.safeParse(keys).success).toBe(true);
    });

    it("사진 키가 6개면 장수 문구로 막는다", () => {
      const keys = Array.from({ length: 6 }, (_, index) => `inquiry/${index}.png`);

      expect(firstMessage(attachmentKeysSchema.safeParse(keys))).toBe(PHOTO_COUNT);
    });
  });
});
