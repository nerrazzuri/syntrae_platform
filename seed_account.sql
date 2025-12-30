INSERT INTO core."Account" (id, name, status, created_at) VALUES ('acc-1234-5678', 'Test Account', 'ACTIVE', now()) ON CONFLICT (id) DO NOTHING;
