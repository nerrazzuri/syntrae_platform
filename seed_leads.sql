-- cleanup
DELETE FROM core."Session" WHERE id IN ('sess-token-user-a', 'sess-token-user-b');
DELETE FROM core."LeadOpportunity" WHERE id IN ('lead-1-acc-a', 'lead-2-acc-b');
DELETE FROM core."EngagementEvent" WHERE id IN ('evt-1-acc-a', 'evt-2-acc-b');
DELETE FROM core."User" WHERE id IN ('user-a', 'user-b');
DELETE FROM core."Account" WHERE id IN ('acc-a', 'acc-b');

-- Accounts
INSERT INTO core."Account" (id, name, status) VALUES ('acc-a', 'Account A', 'ACTIVE');
INSERT INTO core."Account" (id, name, status) VALUES ('acc-b', 'Account B', 'ACTIVE');

-- Users
INSERT INTO core."User" (id, email, password_hash, status) VALUES ('user-a', 'a@test.com', 'hash', 'ACTIVE');
INSERT INTO core."User" (id, email, password_hash, status) VALUES ('user-b', 'b@test.com', 'hash', 'ACTIVE');

-- Sessions (Token = ID)
INSERT INTO core."Session" (id, user_id, active_workspace_id, expires_at) 
VALUES ('sess-token-user-a', 'user-a', 'acc-a', now() + interval '1 day');

INSERT INTO core."Session" (id, user_id, active_workspace_id, expires_at) 
VALUES ('sess-token-user-b', 'user-b', 'acc-b', now() + interval '1 day');

-- Events
INSERT INTO core."EngagementEvent" (id, platform, account_id, metadata, status, dedup_key)
VALUES ('evt-1-acc-a', 'tiktok', 'acc-a', '{}', 'PROCESSED', 'dedup-1');

INSERT INTO core."EngagementEvent" (id, platform, account_id, metadata, status, dedup_key)
VALUES ('evt-2-acc-b', 'tiktok', 'acc-b', '{}', 'PROCESSED', 'dedup-2');

-- Leads
INSERT INTO core."LeadOpportunity" (
    id, platform, video_id, comment_id, user_handle, intent, buyer_stage, 
    confidence, recommended_action, urgency_score, risk_level, 
    source_event_id, account_id, created_at
) VALUES (
    'lead-1-acc-a', 'tiktok', 'vid-1', 'cmt-1', '@buyerA', 'PRODUCT_INQUIRY', 'READY',
    0.95, 'PRIORITY_DM', 0.9, 'LOW',
    'evt-1-acc-a', 'acc-a', now()
);

INSERT INTO core."LeadOpportunity" (
    id, platform, video_id, comment_id, user_handle, intent, buyer_stage, 
    confidence, recommended_action, urgency_score, risk_level, 
    source_event_id, account_id, created_at
) VALUES (
    'lead-2-acc-b', 'tiktok', 'vid-2', 'cmt-2', '@buyerB', 'PRICE_QUESTION', 'EVALUATING',
    0.75, 'RECOMMEND_DM', 0.6, 'LOW',
    'evt-2-acc-b', 'acc-b', now()
);

INSERT INTO core."LeadOpportunity" (
    id, platform, video_id, comment_id, user_handle, intent, buyer_stage, 
    confidence, recommended_action, urgency_score, risk_level, 
    source_event_id, account_id, created_at
) VALUES (
    'lead-3-acc-a', 'tiktok', 'vid-3', 'cmt-3', '@buyerC', 'GENERAL_CHAT', 'AWARENESS',
    0.3, 'SILENT_CAPTURE', 0.1, 'LOW',
    'evt-1-acc-a', 'acc-a', now()
);
