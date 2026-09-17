/** @jsxImportSource hono/jsx */
import type { FC } from "hono/jsx";
import type { AuthScope } from "../model.js";
export interface ScopeListViewProps { scopes: readonly AuthScope[] }
/** Hono JSX keeps this view renderable directly in a Worker without React. */
export const ScopeListView: FC<ScopeListViewProps> = ({ scopes }) => <ul>{scopes.map((scope) => <li key={scope.name}><strong>{scope.label}</strong> <code>{scope.name}</code></li>)}</ul>;
