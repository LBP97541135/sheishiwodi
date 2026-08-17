/**
 * 按模型家族计算“关闭推理链”的额外请求参数，让 deepseek / 豆包(seed) / 千问(qwen)
 * 尽快直出答案；其余模型返回空对象、行为完全不变。
 *
 * 各厂商开关经真实中转站实测确认（本机付费冒烟，2026-08-17）：
 * - 千问 / 阿里云（qwen*）：{ enable_thinking: false }        —— 约 48s → 7s
 * - 豆包 / 火山方舟（seed* / doubao*）：{ thinking: { type: 'disabled' } } —— 约 168s → 7.4s
 * - DeepSeek / 百度千帆（deepseek*）：{ thinking: { type: 'disabled' } }   —— 约 12s → 1.5s
 *   （注意：deepseek 会忽略 enable_thinking，必须用 thinking.type=disabled）
 *
 * 这些参数只是模型请求体字段，绝不含 Base URL / API Key / 请求头。未知模型不附加任何参数。
 */
export function reasoningDisableBodyFor(modelId: string): Record<string, unknown> {
  const id = modelId.trim().toLowerCase();
  if (id.startsWith('qwen')) {
    return { enable_thinking: false };
  }
  if (id.startsWith('seed') || id.startsWith('doubao')) {
    return { thinking: { type: 'disabled' } };
  }
  if (id.startsWith('deepseek')) {
    return { thinking: { type: 'disabled' } };
  }
  return {};
}
