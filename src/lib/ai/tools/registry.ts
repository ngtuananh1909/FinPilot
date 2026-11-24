import type { ToolOutcome } from "../tool-loop";
import { PROPOSAL_TOOL_SCHEMAS, READ_TOOL_SCHEMAS, type ProposalToolName, type ReadToolName } from "./definitions";
import { executeReadTool, type ToolContext } from "./handlers";

/**
 * Handler for the two write-INTENT tools. It may only create a pending proposal; it must never
 * change profile or goal data. Without one, proposal tools answer `proposals_not_enabled`.
 */
export type ProposalHandler = (name: ProposalToolName, args: unknown) => Promise<ToolOutcome>;

const isReadTool = (name: string): name is ReadToolName => Object.prototype.hasOwnProperty.call(READ_TOOL_SCHEMAS, name);
const isProposalTool = (name: string): name is ProposalToolName =>
  Object.prototype.hasOwnProperty.call(PROPOSAL_TOOL_SCHEMAS, name);

/** Builds the `executeTool` callback for runToolLoop, bound to one verified request context. */
export function createToolExecutor(ctx: ToolContext, proposals?: ProposalHandler) {
  return async (name: string, args: unknown): Promise<ToolOutcome> => {
    if (isReadTool(name)) return executeReadTool(ctx, name, args);
    if (isProposalTool(name)) {
      const parsed = PROPOSAL_TOOL_SCHEMAS[name].safeParse(args);
      if (!parsed.success) return { ok: false, error: "invalid_arguments" };
      if (!proposals) return { ok: false, error: "proposals_not_enabled" };
      return proposals(name, parsed.data);
    }
    return { ok: false, error: "unknown_tool" };
  };
}
