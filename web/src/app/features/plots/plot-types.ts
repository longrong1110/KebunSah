// 屏 2 读到的文档形状。字段名是 seed 的临时约定（camelCase）；合同还没有 Firestore 文档示例。
// Timestamp 在读数据层（facade）已统一转成 Date。

export interface PlotData {
  operatorPersonId?: string;
  /** 归哪个合作社（看板按它过滤） */
  coopId?: string | null;
  landTitleId?: string | null;
  nickname?: string | null;
  /** plots 上复制的 titleNo / district（企划书 §8.9：为看板筛选而复制），title 读不到时的回退 */
  titleNo?: string | null;
  district?: string | null;
  /** 评估从地契照片读出的地段号（后端复制到 plots 上）：没有登记地契（landTitleId）的新地块靠它起标题 */
  lotNo?: string | null;
  status?: unknown;
  areaHaComputed?: number | null;
  areaHaDeclared?: number | null;
  lastAssessedAt?: Date | null;
  /** GeoJSON Polygon，存成 JSON 字符串（Firestore 不收嵌套数组）；屏 10 用它画形状预览 */
  polygonGeojson?: string | null;
  // 以下是档案页（导出 PDF）用的字段
  state?: string | null;
  countryCode?: string | null;
  centroidLat?: number | null;
  centroidLng?: number | null;
  oilPalmPlantedYear?: number | null;
  geometryRecordedAt?: Date | null;
  mpobLicenceId?: string | null;
  mspoCertificateId?: string | null;
  isSynthetic?: boolean;
}

export interface PlotItem {
  id: string;
  data: PlotData;
}

/** titles/{id}：卡片标题要的 lotNo 在这里，plots 上没有 */
export interface TitleData {
  lotNo?: string;
  district?: string;
  // 以下是档案页用的字段
  titleNo?: string | null;
  mukim?: string | null;
  state?: string | null;
  /** freehold／leasehold 等 */
  tenure?: string | null;
  /** agriculture 等 */
  landUseCategory?: string | null;
}

/** persons/{id}：故意只声明姓名。icHash / icLast4 会随文档下载到客户端，但界面不用、不渲染、不进日志 */
export interface PersonData {
  fullName?: string;
}

export interface UserData {
  role?: string;
  personId?: string | null;
  /** 所属合作社；看板用它决定读哪个合作社的地块 */
  coopId?: string | null;
  language?: string;
}

const timeOf = (p: PlotItem): number | null => {
  const d = p.data.lastAssessedAt;
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
};

/** 按评估时间新→旧排；没有时间的排最后；时间相同按 id，保证每次顺序一样 */
export function sortPlots(plots: readonly PlotItem[]): PlotItem[] {
  return [...plots].sort((a, b) => {
    const ta = timeOf(a);
    const tb = timeOf(b);
    if (ta !== null && tb !== null && ta !== tb) return tb - ta;
    if (ta !== null && tb === null) return -1;
    if (ta === null && tb !== null) return 1;
    return a.id.localeCompare(b.id);
  });
}
