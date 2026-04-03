INSERT INTO core."Account" (id, name, status, created_at, updated_at) VALUES ('acc-1234-5678', 'Test Account', 'ACTIVE', now(), now()) ON CONFLICT (id) DO NOTHING;
INSERT INTO core."InstallRegistry" (id, install_id, account_id, is_active, install_secret, created_at) VALUES (gen_random_uuid(), 'inst-e2e', 'acc-1234-5678', true, 'secret', now()) ON CONFLICT (install_id) DO NOTHING;
