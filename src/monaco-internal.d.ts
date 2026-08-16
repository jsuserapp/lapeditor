declare module "monaco-editor/platform/actions/common/actions.js" {
  export const MenuId: {
    EditorContext: unknown;
    EditorContextCopy: unknown;
    EditorContextShare: unknown;
  };

  export const MenuRegistry: {
    getMenuItems(id: unknown): unknown[];
    appendMenuItem(id: unknown, item: unknown): { dispose(): void };
  };

  export function isIMenuItem(item: unknown): item is {
    command: { id: string; icon?: unknown };
  };
}

declare module "monaco-editor/platform/commands/common/commands.js" {
  export const CommandsRegistry: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): { dispose(): void };
  };
}

declare module "monaco-editor/platform/contextkey/common/contextkey.js" {
  export const ContextKeyExpr: {
    has(key: string): unknown;
    deserialize(value: string): unknown;
  };
}
