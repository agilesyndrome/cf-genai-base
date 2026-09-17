/** @jsxImportSource hono/jsx */

import type { FC } from "hono/jsx";
import type { AuthGroup } from "../model.js";

export interface GroupListViewProps {
  groups: readonly AuthGroup[];
  title?: string;
}

/** Optional Hono JSX view for server-rendered admin shells. React UI remains separate. */
export const GroupListView: FC<GroupListViewProps> = ({ groups, title = "Groups" }) => (
  <section>
    <h1>{title}</h1>
    {groups.length ? (
      <ul>
        {groups.map((group) => (
          <li key={group.name}>
            <strong>{group.display_name}</strong>
            <small>{group.name}</small>
            {group.description ? <p>{group.description}</p> : null}
          </li>
        ))}
      </ul>
    ) : (
      <p>No groups registered.</p>
    )}
  </section>
);
