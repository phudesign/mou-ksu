-- Test data for development only.
-- Login uses LDAP: seed usernames must match real LDAP accounts to sign in.
-- Usage: mysql -u root -p mou_db < database/seed.sql
-- The sample MOU expects backend/uploads/pdfs/sample-mou.pdf (create with: cd backend && npm run sample-pdf)

SET NAMES utf8mb4;

INSERT INTO users (id, username, password, fname, lname, `_role`) VALUES
  (1, 'manop.ka',       '$2b$10$tpA3OWMMWPLfcW5JC3J7NePXaYu7TlmNaxMwsldmvU82.DXWdC9eO', 'ผู้ดูแล', 'ระบบ',      'admin'),
  (2, 'rector',      '$2b$10$tpA3OWMMWPLfcW5JC3J7NePXaYu7TlmNaxMwsldmvU82.DXWdC9eO', 'สมชาย',   'อธิการบดี',  'signer'),
  (3, 'vice_rector', '$2b$10$tpA3OWMMWPLfcW5JC3J7NePXaYu7TlmNaxMwsldmvU82.DXWdC9eO', 'สมหญิง',  'รองอธิการบดี', 'signer'),
  (4, 'witness',     '$2b$10$tpA3OWMMWPLfcW5JC3J7NePXaYu7TlmNaxMwsldmvU82.DXWdC9eO', 'วิชัย',   'พยาน',       'signer');

INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('signing_mode', 'primary');

INSERT INTO mou_documents (id, title, pdf_path, status, visibility, created_by) VALUES
  (1, 'MOU ตัวอย่าง — ความร่วมมือทางวิชาการ', 'pdfs/sample-mou.pdf', 'pending', 'private', 1);

INSERT INTO mou_signature_boxes (mou_id, user_id, role_name, page_number, pos_x, pos_y, width, height) VALUES
  (1, 2, 'อธิการบดี',    1, 10, 70, 25, 10),
  (1, 3, 'รองอธิการบดี', 1, 40, 70, 25, 10),
  (1, 4, 'พยาน',         1, 70, 70, 25, 10);
