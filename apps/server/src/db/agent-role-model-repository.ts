import { eq } from 'drizzle-orm';

import type { AppDatabase } from './client.js';
import { agentRoleModels } from './schema.js';

/**
 * 角色模型选择的持久化仓库。只读写 role_id → model_id 映射；
 * Base URL、API Key、请求头等敏感配置不属于此表，永远只留在服务端 env。
 */
export class AgentRoleModelRepository {
  constructor(private readonly database: AppDatabase) {}

  getSelection(roleId: string): string | null {
    const row = this.database.db
      .select()
      .from(agentRoleModels)
      .where(eq(agentRoleModels.roleId, roleId))
      .get();
    return row?.modelId ?? null;
  }

  listSelections(): Record<string, string> {
    const rows = this.database.db.select().from(agentRoleModels).all();
    return Object.fromEntries(rows.map((row) => [row.roleId, row.modelId]));
  }

  setSelection(roleId: string, modelId: string, updatedAt: string) {
    this.database.db
      .insert(agentRoleModels)
      .values({ roleId, modelId, updatedAt })
      .onConflictDoUpdate({
        target: agentRoleModels.roleId,
        set: { modelId, updatedAt },
      })
      .run();
  }
}
