// Feedback → Inbox. Members file a note (bug / question / missing card) and
// read replies in their inbox. Replying is an operator action from the owner
// console (/admin/feedback, see app/admin.ts) — `replyFeedback` /
// `closeFeedback` are deliberately unscoped for that reason.

import { query, one } from "../pg.ts";
import { currentSellerId } from "./session-context.ts";

export async function ensureFeedbackSchema(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      seller_id   bigint NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
      kind        text   NOT NULL DEFAULT 'feedback',   -- feedback | bug | question | missing_card
      title       text   NOT NULL,
      body        text   NOT NULL DEFAULT '',
      status      text   NOT NULL DEFAULT 'open',       -- open | answered | closed
      reply       text,
      created_at  timestamptz NOT NULL DEFAULT now(),
      replied_at  timestamptz
    )`);
  await query(`CREATE INDEX IF NOT EXISTS idx_feedback_seller ON feedback(seller_id, id DESC)`);
}

export const FEEDBACK_KINDS: Array<{ key: string; label: string }> = [
  { key: "feedback", label: "Feedback" },
  { key: "bug", label: "Something's broken" },
  { key: "question", label: "Question" },
  { key: "missing_card", label: "Card missing from catalog" },
];
export const FEEDBACK_TITLE_MAX = 120;
export const FEEDBACK_BODY_MAX = 4000;

export type Feedback = {
  id: number;
  seller_id: number;
  kind: string;
  title: string;
  body: string;
  status: string;
  reply: string | null;
  created_at: string;
  replied_at: string | null;
};

export async function submitFeedback(kind: string, title: string, body: string): Promise<number> {
  const k = FEEDBACK_KINDS.some((x) => x.key === kind) ? kind : "feedback";
  const r = await one<{ id: number }>(
    `INSERT INTO feedback(seller_id, kind, title, body) VALUES ($1,$2,$3,$4) RETURNING id`,
    [currentSellerId(), k, title.trim().slice(0, FEEDBACK_TITLE_MAX), body.trim().slice(0, FEEDBACK_BODY_MAX)]
  );
  return r!.id;
}

export function listFeedback(limit = 100): Promise<Feedback[]> {
  return query<Feedback>("SELECT * FROM feedback WHERE seller_id=$1 ORDER BY id DESC LIMIT $2", [currentSellerId(), limit]);
}

/** Operator reply (unscoped on purpose — the owner answers any member's note from /admin/feedback). */
export async function replyFeedback(id: number, reply: string): Promise<void> {
  await query("UPDATE feedback SET reply=$1, status='answered', replied_at=now() WHERE id=$2", [reply.trim(), id]);
}

/** Close a note (owner action); an accompanying reply, if any, is saved too. */
export async function closeFeedback(id: number, reply?: string): Promise<void> {
  const r = (reply ?? "").trim();
  await query(
    "UPDATE feedback SET status='closed', reply=COALESCE(NULLIF($1,''), reply), replied_at=CASE WHEN NULLIF($1,'') IS NULL THEN replied_at ELSE now() END WHERE id=$2",
    [r, id]
  );
}
