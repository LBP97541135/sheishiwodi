// 信息隔离哨兵与扫描。只判断“敏感串是否出现在某通道的序列化文本中”，
// 返回 { channel, category, pass } —— 报告只记类别名与布尔，绝不落敏感原值。
// 对齐 game-flow.test.ts:879-907 的公开帧断言与 agent-runtime.test.ts:66-142 的输入断言。

export interface SentinelCategory {
  name: string;
  /** 命中即视为泄漏的明文集合，仅驻留内存用于扫描，绝不进入报告。 */
  values: string[];
}

export interface LeakResult {
  channel: string;
  category: string;
  pass: boolean;
}

// 营地哨兵：检测“营地归属”泄漏。用 JSON 字符串值形态（带引号）匹配，
// 只命中真实的营地赋值 `"camp":"undercover"` / `"civilian"` 与词牌内部字段名，
// 而不会误伤公开字段 `undercoverCount`（卧底人数属公开规则，非营地泄漏）；
// 公开文本里玩家自然语言说“卧底”亦不含带引号 JSON token，故不误报。
export const CAMP_SENTINELS: SentinelCategory = {
  name: 'camp',
  values: ['"camp"', 'civilianWord', 'undercoverWord', '"undercover"', '"civilian"'],
};

export const BELIEF_INTERNAL_SENTINELS: SentinelCategory = {
  name: 'beliefInternals',
  values: ['reasoningSummary', 'probability', 'opposingWord', 'confidence'],
};

/** 凭据哨兵：Base URL / API Key / 授权头，任何通道都不得出现。值只驻留内存。 */
export function credentialSentinels(baseUrl: string, apiKey: string): SentinelCategory {
  const values = ['Bearer ', 'Authorization', baseUrl, apiKey].filter((value) => value.length > 0);
  return { name: 'credentials', values };
}

/** 词牌哨兵：传入的词牌明文集合不得出现（调用方决定是否排除行动者自己的词牌）。 */
export function wordSentinels(words: readonly string[]): SentinelCategory[] {
  const values = [...new Set(words)].filter((word) => word.length > 0);
  return values.length > 0 ? [{ name: 'wordCards', values }] : [];
}

/** 扫描：serialized 中命中任一 value 即该类别 pass=false。 */
export function scan(
  channel: string,
  serialized: string,
  categories: readonly SentinelCategory[],
): LeakResult[] {
  return categories.map((category) => ({
    channel,
    category: category.name,
    pass: !category.values.some((value) => serialized.includes(value)),
  }));
}
