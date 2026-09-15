import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { knowledgeSchemas } from "@/shared/contracts/knowledge";
import type { ControlService } from "@/server/control-service";
import type { AuthenticatedPrincipal } from "@/server/modules/identity";
import { knowledgeFailure } from "@/server/modules/knowledge";

/** Scoped sessions expose knowledge only; legacy runtime sessions never enter here. */
export function registerKnowledgeTools(server: McpServer, service: ControlService, actor: AuthenticatedPrincipal): void {
  for (const [operation, schema] of Object.entries(knowledgeSchemas)) {
    const readOnly = ["project", "projects", "threads", "thread", "replies", "reply", "tasks", "task", "relations", "history", "memories", "memory", "search", "task_context", "export_context", "check_context_export", "attachments", "attachment"].includes(operation);
    server.registerTool(`knowledge_${operation}`, {
      description: `${operation.replaceAll("_", " ")} in project knowledge. Writes require a stable idempotencyKey; reuse it for an identical retry. Read pages expose nextOffset. No runtime claim or server operation.`,
      inputSchema: schema,
      annotations: { readOnlyHint: readOnly, idempotentHint: true, destructiveHint: false, openWorldHint: false },
    }, async (input: unknown) => {
      try {
        const result = service.executeKnowledge({ operation, input }, actor);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      } catch (error) {
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(knowledgeFailure(error).body) }] };
      }
    });
  }
}
