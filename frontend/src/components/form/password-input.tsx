"use client";

import Image from "next/image";
import { useState, type ComponentProps } from "react";

import { TextInput } from "./field";

/** 눈 아이콘으로 비밀번호를 보이거나 숨기는 입력칸 (Figma S01 Icon eye-off) */
export function PasswordInput(props: Omit<ComponentProps<typeof TextInput>, "type" | "trailing">) {
  const [visible, setVisible] = useState(false);

  return (
    <TextInput
      {...props}
      type={visible ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"}
          aria-pressed={visible}
          className="flex shrink-0 cursor-pointer items-center"
        >
          <Image
            src={visible ? "/auth/icon-eye.svg" : "/auth/icon-eye-off.svg"}
            alt=""
            width={20}
            height={20}
          />
        </button>
      }
    />
  );
}
