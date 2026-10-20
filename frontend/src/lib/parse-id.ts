// 기준: Swagger 경로 값 applicationId · sessionId(양의 정수) · SessionPath

/** 주소에 붙은 id(양의 정수)를 읽는다. 없거나 형식이 틀리면 null */
export function parsePositiveId(value: string | string[] | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
