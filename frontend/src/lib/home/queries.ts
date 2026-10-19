import { api } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";

import type { HomeResponse } from "./types";

/** 3.1 홈. 서버 컴포넌트에서만 부른다. */
export async function getHome(): Promise<HomeResponse> {
  const { data } = await api.get<HomeResponse>(endpoints.home.home);
  return data;
}
