// TotalsRow helper (04 §4.8, 02 §6) — builds the pinned summary row every
// filtered register carries. Honest about scope: a server aggregate over the
// whole filter labels itself «Jami»; a client-side sum of the loaded page
// labels itself «sahifa jami» (02 §1.6). It is a plain builder returning an
// AntD Table summary node, used as `summary={() => totalsRow({ … })}` — not a
// hook, so it renders through AntD Typography for theme-correct color.
import type { ReactNode } from 'react';
import { Table, Typography } from 'antd';

export interface TotalsCell {
  /** the column index this cell sits at (matches AntD Table.Summary.Cell). */
  index: number;
  content?: ReactNode;
  colSpan?: number;
  align?: 'left' | 'center' | 'right';
  /** render bold (default true — totals are emphasized cells). */
  strong?: boolean;
}

export interface TotalsRowOptions {
  /** 'server' → «Jami» (whole filter); 'page' → «sahifa jami» (loaded rows). */
  scope: 'page' | 'server';
  /** the value cells, by column index. */
  cells: TotalsCell[];
  /** override the scope label. */
  label?: string;
  /** column index the scope label sits at (default 0). */
  labelIndex?: number;
  /** how many columns the label cell spans (default 1). */
  labelColSpan?: number;
}

const scopeLabelFor = (scope: 'page' | 'server'): string =>
  scope === 'server' ? 'Jami' : 'sahifa jami';

/** Returns a `<Table.Summary.Row>` node for a Table `summary` render function. */
export function totalsRow(opts: TotalsRowOptions): ReactNode {
  const { scope, cells, label, labelIndex = 0, labelColSpan = 1 } = opts;
  return (
    <Table.Summary.Row>
      <Table.Summary.Cell index={labelIndex} colSpan={labelColSpan}>
        <Typography.Text
          type="secondary"
          style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em' }}
        >
          {label ?? scopeLabelFor(scope)}
        </Typography.Text>
      </Table.Summary.Cell>
      {cells.map((cell) => (
        <Table.Summary.Cell
          key={cell.index}
          index={cell.index}
          colSpan={cell.colSpan}
          align={cell.align ?? 'right'}
        >
          <Typography.Text strong={cell.strong ?? true}>{cell.content}</Typography.Text>
        </Table.Summary.Cell>
      ))}
    </Table.Summary.Row>
  );
}
