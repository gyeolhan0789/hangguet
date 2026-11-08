"use client";

import { motion } from "motion/react";
import Image from "next/image";

import { PASSWORD_RULES } from "@/lib/auth/schemas";

/** 비밀번호 규칙 칩(Figma S01-1). 회원가입 · 비밀번호 재설정이 같이 쓴다 */
export function PasswordRules({ password }: { password: string }) {
  return (
    <ul className="flex gap-2.5">
      {PASSWORD_RULES.map(({ label, test }) => {
        const passed = test(password);
        return (
          <li key={label} className="flex items-center gap-1">
            <motion.span
              className="flex"
              initial={false}
              animate={passed ? { scale: [0.4, 1.2, 1] } : { scale: 1 }}
              transition={{ duration: 0.25 }}
            >
              <Image
                src={passed ? "/auth/icon-check-rule.svg" : "/auth/icon-circle-rule.svg"}
                alt=""
                width={12}
                height={12}
              />
            </motion.span>
            <span
              className={`text-xs leading-normal font-semibold ${passed ? "text-success" : "text-text-3"}`}
            >
              {label}
              <span className="sr-only">{passed ? " 충족" : " 미충족"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
