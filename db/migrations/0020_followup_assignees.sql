-- Follow-up lists can be assigned (27 Nov 2026): Admin or Manager picks the people who work a list.
-- Several people can share one list. They can change statuses, WhatsApp and log calls; only Admin, Manager or whoever
-- made the list can assign, close or reopen it.
CREATE TABLE follow_up_assignees (
  list_id     INTEGER NOT NULL REFERENCES follow_up_lists(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  assigned_by INTEGER NOT NULL REFERENCES users(id),
  assigned_at TEXT NOT NULL DEFAULT now_iso(),
  PRIMARY KEY (list_id, user_id)
);
CREATE INDEX ix_follow_up_assignees_user ON follow_up_assignees(user_id);
ALTER TABLE follow_up_assignees ENABLE ROW LEVEL SECURITY;
